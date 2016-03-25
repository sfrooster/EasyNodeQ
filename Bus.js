///<reference path='./typings/main/ambient/node/index.d.ts' />
///<reference path='./typings/main/ambient/bluebird/index.d.ts' />
///<reference path='./typings/main/definitions/node-uuid/index.d.ts' />
"use strict";
const util = require('util');
var amqp = require('amqplib');
const Promise = require('bluebird');
const uuid = require('node-uuid');
class RabbitHutch {
    static CreateBus(config) {
        var bus = new Bus(config);
        return bus;
    }
}
exports.RabbitHutch = RabbitHutch;
class Bus {
    constructor(config) {
        this.config = config;
        this.rpcQueue = null;
        this.rpcResponseHandlers = {};
        this.Channels = {
            publishChannel: null,
            rpcChannel: null
        };
        try {
            this.Connection = Promise.resolve(amqp.connect(config.url + (config.vhost !== null ? '/' + config.vhost : '') + '?heartbeat=' + config.heartbeat));
            this.pubChanUp = this.Connection
                .then((connection) => connection.createConfirmChannel())
                .then((confChanReply) => {
                this.Channels.publishChannel = confChanReply;
                return true;
            });
        }
        catch (e) {
            console.log('[ERROR] - Connection problem %s', e);
        }
    }
    // TODO: handle error for msg (can't stringify error)
    SendToErrorQueue(msg, err = '', stack = '') {
        var errMsg = {
            TypeID: 'Common.ErrorMessage:Messages',
            Message: msg === void 0 ? null : JSON.stringify(msg),
            Error: err === void 0 ? null : err,
            Stack: stack === void 0 ? null : stack
        };
        return this.pubChanUp
            .then(() => this.Channels.publishChannel.assertQueue(Bus.defaultErrorQueue, { durable: true, exclusive: false, autoDelete: false }))
            .then(() => this.Send(Bus.defaultErrorQueue, errMsg));
    }
    // ========== Publish / Subscribe ==========
    Publish(msg, withTopic = '') {
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', msg.TypeID));
        }
        return this.pubChanUp
            .then(() => this.Channels.publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => this.Channels.publishChannel.publish(msg.TypeID, withTopic, Bus.ToBuffer(msg), { type: msg.TypeID }));
    }
    Subscribe(type, subscriberName, handler, withTopic = '#') {
        if (typeof type.TypeID !== 'string' || type.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', type.TypeID));
        }
        if (typeof handler !== 'function') {
            return Promise.reject('xyz is not a valid function');
        }
        var queueID = type.TypeID + '_' + subscriberName;
        return this.Connection.then((connection) => {
            return Promise.resolve(connection.createChannel())
                .then((channel) => {
                channel.prefetch(this.config.prefetch);
                return channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false })
                    .then(() => channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false }))
                    .then(() => channel.bindQueue(queueID, type.TypeID, withTopic))
                    .then(() => channel.consume(queueID, (msg) => {
                    if (msg) {
                        var _msg = Bus.FromSubscription(msg);
                        if (msg.properties.type === type.TypeID) {
                            _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                            var ackdOrNackd = false;
                            handler(_msg, {
                                ack: () => {
                                    channel.ack(msg);
                                    ackdOrNackd = true;
                                },
                                nack: () => {
                                    if (!msg.fields.redelivered) {
                                        channel.nack(msg);
                                    }
                                    else {
                                        //can only nack once
                                        this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                    }
                                    ackdOrNackd = true;
                                }
                            });
                            if (!ackdOrNackd)
                                channel.ack(msg);
                        }
                        else {
                            this.SendToErrorQueue(_msg, util.format('mismatched TypeID: %s !== %s', msg.properties.type, type.TypeID));
                        }
                    }
                }))
                    .then((ctag) => {
                    return {
                        cancelConsumer: () => {
                            return channel.cancel(ctag.consumerTag)
                                .then(() => true)
                                .catch(() => false);
                        },
                        deleteQueue: () => {
                            return channel.deleteQueue(queueID)
                                .then(() => true)
                                .catch(() => false);
                        }
                    };
                });
            });
        });
    }
    // ========== Send / Receive ==========
    Send(queue, msg) {
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', JSON.stringify(msg.TypeID)));
        }
        return this.pubChanUp
            .then(() => this.Channels.publishChannel.sendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID }));
    }
    Receive(rxType, queue, handler) {
        var channel = null;
        return this.Connection.then((connection) => {
            return Promise.resolve(connection.createChannel())
                .then((chanReply) => {
                channel = chanReply;
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then((okQueueReply) => channel.consume(queue, (msg) => {
                if (msg) {
                    var _msg = Bus.FromSubscription(msg);
                    if (msg.properties.type === rxType.TypeID) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                        var ackdOrNackd = false;
                        handler(_msg, {
                            ack: () => {
                                channel.ack(msg);
                                ackdOrNackd = true;
                            },
                            nack: () => {
                                if (!msg.fields.redelivered) {
                                    channel.nack(msg);
                                }
                                else {
                                    //can only nack once
                                    this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                }
                                ackdOrNackd = true;
                            }
                        });
                        if (!ackdOrNackd)
                            channel.ack(msg);
                    }
                    else {
                        this.SendToErrorQueue(_msg, util.format('mismatched TypeID: %s !== %s', msg.properties.type, rxType.TypeID));
                    }
                }
            })
                .then((ctag) => {
                return {
                    cancelConsumer: () => {
                        return channel.cancel(ctag.consumerTag)
                            .then(() => true)
                            .catch(() => false);
                    },
                    deleteQueue: () => {
                        return channel.deleteQueue(queue)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    ReceiveTypes(queue, handlers) {
        var channel = null;
        return this.Connection.then((connection) => {
            return Promise.resolve(connection.createChannel())
                .then((chanReply) => {
                channel = chanReply;
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then((okQueueReply) => channel.consume(queue, (msg) => {
                var _msg = Bus.FromSubscription(msg);
                handlers.filter((handler) => handler.rxType.TypeID === msg.properties.type).forEach((handler) => {
                    _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                    var ackdOrNackd = false;
                    handler.handler(_msg, {
                        ack: () => {
                            channel.ack(msg);
                            ackdOrNackd = true;
                        },
                        nack: () => {
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        }
                    });
                    if (!ackdOrNackd)
                        channel.ack(msg);
                });
            })
                .then((ctag) => {
                return {
                    cancelConsumer: () => {
                        return channel.cancel(ctag.consumerTag)
                            .then(() => true)
                            .catch(() => false);
                    },
                    deleteQueue: () => {
                        return channel.deleteQueue(queue)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    // ========== Request / Response ==========
    Request(request) {
        var responseDeferred = Promise.defer();
        var correlationID = uuid.v4();
        this.rpcResponseHandlers[correlationID] = {
            deferred: responseDeferred,
            timeoutID: setTimeout(() => {
                delete this.rpcResponseHandlers[correlationID];
                throw Error('Timed-out waiting for RPC response, correlationID: ' + correlationID);
            }, this.config.rpcTimeout || 30000)
        };
        this.rpcConsumerUp = this.rpcConsumerUp || this.Connection
            .then((connection) => connection.createChannel())
            .then((channelReply) => {
            this.Channels.rpcChannel = channelReply;
            this.rpcQueue = Bus.rpcQueueBase + uuid.v4();
            return this.Channels.rpcChannel.assertQueue(this.rpcQueue, { durable: false, exclusive: true, autoDelete: true });
        })
            .then((okQueueReply) => {
            return this.Channels.rpcChannel.consume(this.rpcQueue, (msg) => {
                if (this.rpcResponseHandlers[msg.properties.correlationId]) {
                    this.Channels.rpcChannel.ack(msg);
                    clearTimeout(this.rpcResponseHandlers[msg.properties.correlationId].timeoutID);
                    var _msg = Bus.FromSubscription(msg);
                    _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                    this.rpcResponseHandlers[msg.properties.correlationId].deferred.resolve(_msg);
                    delete this.rpcResponseHandlers[msg.properties.correlationId];
                }
                else {
                }
            });
        })
            .then((okSubscribeReply) => {
            this.rpcConsumerTag = okSubscribeReply.consumerTag;
            return true;
        });
        return this.rpcConsumerUp
            .then(() => this.Channels.publishChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => this.Channels.publishChannel.publish(Bus.rpcExchange, request.TypeID, Bus.ToBuffer(request), { type: request.TypeID, replyTo: this.rpcQueue, correlationId: correlationID }))
            .then((ackd) => responseDeferred.promise);
    }
    Respond(rqType, rsType, responder) {
        return this.Connection
            .then((connection) => connection.createChannel())
            .then((responseChan) => {
            return responseChan.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })
                .then((okExchangeReply) => responseChan.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false }))
                .then((okQueueReply) => responseChan.bindQueue(rqType.TypeID, Bus.rpcExchange, rqType.TypeID))
                .then((okBindReply) => responseChan.consume(rqType.TypeID, (reqMsg) => {
                var msg = Bus.FromSubscription(reqMsg);
                if (reqMsg.properties.type === rqType.TypeID) {
                    msg.TypeID = msg.TypeID || reqMsg.properties.type; //so we can get non-BusMessage events
                    var replyTo = reqMsg.properties.replyTo;
                    var correlationID = reqMsg.properties.correlationId;
                    var ackdOrNackd = false;
                    var response = responder(msg, {
                        ack: () => {
                            responseChan.ack(reqMsg);
                            ackdOrNackd = true;
                        },
                        nack: () => {
                            if (!reqMsg.fields.redelivered) {
                                responseChan.nack(reqMsg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        }
                    });
                    this.Channels.publishChannel.publish('', replyTo, Bus.ToBuffer(response), { type: rsType.TypeID, correlationId: correlationID });
                    if (!ackdOrNackd)
                        responseChan.ack(reqMsg);
                }
                else {
                    this.SendToErrorQueue(msg, util.format('mismatched TypeID: %s !== %s', reqMsg.properties.type, rqType.TypeID));
                }
            })
                .then((ctag) => {
                return {
                    cancelConsumer: () => {
                        return responseChan.cancel(ctag.consumerTag)
                            .then(() => true)
                            .catch(() => false);
                    },
                    deleteQueue: () => {
                        return responseChan.deleteQueue(rqType.TypeID)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    RespondAsync(rqType, rsType, responder) {
        return this.Connection
            .then((connection) => connection.createChannel())
            .then((responseChan) => {
            return responseChan.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })
                .then((okExchangeReply) => responseChan.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false }))
                .then((okQueueReply) => responseChan.bindQueue(rqType.TypeID, Bus.rpcExchange, rqType.TypeID))
                .then((okBindReply) => responseChan.consume(rqType.TypeID, (reqMsg) => {
                var msg = Bus.FromSubscription(reqMsg);
                if (reqMsg.properties.type === rqType.TypeID) {
                    msg.TypeID = msg.TypeID || reqMsg.properties.type; //so we can get non-BusMessage events
                    var replyTo = reqMsg.properties.replyTo;
                    var correlationID = reqMsg.properties.correlationId;
                    var ackdOrNackd = false;
                    responder(msg, {
                        ack: () => {
                            responseChan.ack(reqMsg);
                            ackdOrNackd = true;
                        },
                        nack: () => {
                            if (!reqMsg.fields.redelivered) {
                                responseChan.nack(reqMsg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        }
                    })
                        .then((response) => {
                        this.Channels.publishChannel.publish('', replyTo, Bus.ToBuffer(response), { type: rsType.TypeID, correlationId: correlationID });
                        if (!ackdOrNackd)
                            responseChan.ack(reqMsg);
                    });
                }
                else {
                    this.SendToErrorQueue(msg, util.format('mismatched TypeID: %s !== %s', reqMsg.properties.type, rqType.TypeID));
                }
            })
                .then((ctag) => {
                return {
                    cancelConsumer: () => {
                        return responseChan.cancel(ctag.consumerTag)
                            .then(() => true)
                            .catch(() => false);
                    },
                    deleteQueue: () => {
                        return responseChan.deleteQueue(rqType.TypeID)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    // ========== Etc  ==========
    static ToBuffer(obj) {
        Bus.remove$type(obj);
        return new Buffer(JSON.stringify(obj));
    }
    static FromSubscription(obj) {
        //fields: "{"consumerTag":"amq.ctag-QreMJ-zvC07EW2EKtWZhmQ","deliveryTag":1,"redelivered":false,"exchange":"","routingKey":"easynetq.response.0303b47c-2229-4557-9218-30c99c67f8c9"}"
        //props:  "{"headers":{},"deliveryMode":1,"correlationId":"14ac579e-048b-4c30-b909-50841cce3e44","type":"Common.TestMessageRequestAddValueResponse:Findly"}"
        var msg = JSON.parse(obj.content.toString());
        Bus.remove$type(msg);
        return msg;
    }
    // ========== Extended ==========
    CancelConsumer(consumerTag) {
        return Promise.resolve(this.Channels.publishChannel.cancel(consumerTag));
    }
    DeleteExchange(exchange, ifUnused = false) {
        this.Channels.publishChannel.deleteExchange(exchange, { ifUnused: ifUnused });
    }
    DeleteQueue(queue, ifUnused = false, ifEmpty = false) {
        return Promise.resolve(this.Channels.publishChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty }));
    }
    DeleteQueueUnconditional(queue) {
        return Promise.resolve(this.Channels.publishChannel.deleteQueue(queue));
    }
    QueueStatus(queue) {
        return Promise.resolve(this.Channels.publishChannel.checkQueue(queue));
    }
}
Bus.rpcExchange = 'easy_net_q_rpc';
Bus.rpcQueueBase = 'easynetq.response.';
Bus.defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
Bus.remove$type = (obj) => {
    try {
        delete obj.$type;
        var o;
        for (o in obj) {
            if (obj.hasOwnProperty(o) && obj[o] === Object(obj[o]))
                Bus.remove$type(obj[o]);
        }
    }
    catch (e) {
        console.error('[Bus gulping error: %s]', e.message);
    }
};
exports.Bus = Bus;
//# sourceMappingURL=Bus.js.map