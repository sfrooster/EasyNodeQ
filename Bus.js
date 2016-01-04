var util = require('util');
var amqp = require('amqplib');
var Promise = require('bluebird');
var uuid = require('node-uuid');
var RabbitHutch = (function () {
    function RabbitHutch() {
    }
    RabbitHutch.CreateBus = function (config) {
        var bus = new Bus(config);
        return bus;
    };
    return RabbitHutch;
})();
exports.RabbitHutch = RabbitHutch;
var Bus = (function () {
    function Bus(config) {
        var _this = this;
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
                .then(function (connection) { return connection.createConfirmChannel(); })
                .then(function (confChanReply) {
                _this.Channels.publishChannel = confChanReply;
                return true;
            });
        }
        catch (e) {
            console.log('[ERROR] - Connection problem %s', e);
        }
    }
    // TODO: handle error for msg (can't stringify error)
    Bus.prototype.SendToErrorQueue = function (msg, err, stack) {
        var _this = this;
        if (err === void 0) { err = ''; }
        if (stack === void 0) { stack = ''; }
        var errMsg = {
            TypeID: 'Common.ErrorMessage:Messages',
            Message: msg === void 0 ? null : JSON.stringify(msg),
            Error: err === void 0 ? null : err,
            Stack: stack === void 0 ? null : stack
        };
        return this.pubChanUp
            .then(function () { return _this.Channels.publishChannel.assertQueue(Bus.defaultErrorQueue, { durable: true, exclusive: false, autoDelete: false }); })
            .then(function () { return _this.Send(Bus.defaultErrorQueue, errMsg); });
    };
    // ========== Publish / Subscribe ==========
    Bus.prototype.Publish = function (msg, withTopic) {
        var _this = this;
        if (withTopic === void 0) { withTopic = ''; }
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', msg.TypeID));
        }
        return this.pubChanUp
            .then(function () { return _this.Channels.publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false }); })
            .then(function (okExchangeReply) { return _this.Channels.publishChannel.publish(msg.TypeID, withTopic, Bus.ToBuffer(msg), { type: msg.TypeID }); });
    };
    Bus.prototype.Subscribe = function (type, subscriberName, handler, withTopic) {
        var _this = this;
        if (withTopic === void 0) { withTopic = '#'; }
        if (typeof type.TypeID !== 'string' || type.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', type.TypeID));
        }
        var queueID = type.TypeID + '_' + subscriberName;
        return this.Connection.then(function (connection) {
            return Promise.resolve(connection.createChannel())
                .then(function (channel) {
                channel.prefetch(_this.config.prefetch);
                return channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false })
                    .then(function () { return channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false }); })
                    .then(function () { return channel.bindQueue(queueID, type.TypeID, withTopic); })
                    .then(function () { return channel.consume(queueID, function (msg) {
                    if (msg) {
                        var _msg = Bus.FromSubscription(msg);
                        if (msg.properties.type === type.TypeID) {
                            _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                            var ackdOrNackd = false;
                            handler(_msg, {
                                ack: function () {
                                    channel.ack(msg);
                                    ackdOrNackd = true;
                                },
                                nack: function () {
                                    if (!msg.fields.redelivered) {
                                        channel.nack(msg);
                                    }
                                    else {
                                        //can only nack once
                                        _this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                    }
                                    ackdOrNackd = true;
                                }
                            });
                            if (!ackdOrNackd)
                                channel.ack(msg);
                        }
                        else {
                            _this.SendToErrorQueue(_msg, util.format('mismatched TypeID: %s !== %s', msg.properties.type, type.TypeID));
                        }
                    }
                }); })
                    .then(function (ctag) {
                    return {
                        cancelConsumer: function () {
                            return channel.cancel(ctag.consumerTag)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        },
                        deleteQueue: function () {
                            return channel.deleteQueue(queueID)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        }
                    };
                });
            });
        });
    };
    // ========== Send / Receive ==========
    Bus.prototype.Send = function (queue, msg) {
        var _this = this;
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return Promise.reject(util.format('%s is not a valid TypeID', JSON.stringify(msg.TypeID)));
        }
        return this.pubChanUp
            .then(function () { return _this.Channels.publishChannel.sendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID }); });
    };
    Bus.prototype.Receive = function (rxType, queue, handler) {
        var _this = this;
        var channel = null;
        return this.Connection.then(function (connection) {
            return Promise.resolve(connection.createChannel())
                .then(function (chanReply) {
                channel = chanReply;
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then(function (okQueueReply) {
                return channel.consume(queue, function (msg) {
                    if (msg) {
                        var _msg = Bus.FromSubscription(msg);
                        if (msg.properties.type === rxType.TypeID) {
                            _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                            var ackdOrNackd = false;
                            handler(_msg, {
                                ack: function () {
                                    channel.ack(msg);
                                    ackdOrNackd = true;
                                },
                                nack: function () {
                                    if (!msg.fields.redelivered) {
                                        channel.nack(msg);
                                    }
                                    else {
                                        //can only nack once
                                        _this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                    }
                                    ackdOrNackd = true;
                                }
                            });
                            if (!ackdOrNackd)
                                channel.ack(msg);
                        }
                        else {
                            _this.SendToErrorQueue(_msg, util.format('mismatched TypeID: %s !== %s', msg.properties.type, rxType.TypeID));
                        }
                    }
                })
                    .then(function (ctag) {
                    return {
                        cancelConsumer: function () {
                            return channel.cancel(ctag.consumerTag)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        },
                        deleteQueue: function () {
                            return channel.deleteQueue(queue)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        }
                    };
                });
            });
        });
    };
    Bus.prototype.ReceiveTypes = function (queue, handlers) {
        var _this = this;
        var channel = null;
        return this.Connection.then(function (connection) {
            return Promise.resolve(connection.createChannel())
                .then(function (chanReply) {
                channel = chanReply;
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then(function (okQueueReply) {
                return channel.consume(queue, function (msg) {
                    var _msg = Bus.FromSubscription(msg);
                    handlers.filter(function (handler) { return handler.rxType.TypeID === msg.properties.type; }).forEach(function (handler) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                        var ackdOrNackd = false;
                        handler.handler(_msg, {
                            ack: function () {
                                channel.ack(msg);
                                ackdOrNackd = true;
                            },
                            nack: function () {
                                if (!msg.fields.redelivered) {
                                    channel.nack(msg);
                                }
                                else {
                                    //can only nack once
                                    _this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                }
                                ackdOrNackd = true;
                            }
                        });
                        if (!ackdOrNackd)
                            channel.ack(msg);
                    });
                })
                    .then(function (ctag) {
                    return {
                        cancelConsumer: function () {
                            return channel.cancel(ctag.consumerTag)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        },
                        deleteQueue: function () {
                            return channel.deleteQueue(queue)
                                .then(function () { return true; })
                                .catch(function () { return false; });
                        }
                    };
                });
            });
        });
    };
    // ========== Request / Response ==========
    Bus.prototype.Request = function (request) {
        var _this = this;
        var responseDeferred = Promise.defer();
        var correlationID = uuid.v4();
        this.rpcResponseHandlers[correlationID] = {
            deferred: responseDeferred,
            timeoutID: setTimeout(function () {
                delete _this.rpcResponseHandlers[correlationID];
                throw Error('Timed-out waiting for RPC response, correlationID: ' + correlationID);
            }, this.config.rpcTimeout || 30000)
        };
        this.rpcConsumerUp = this.rpcConsumerUp || this.Connection
            .then(function (connection) { return connection.createChannel(); })
            .then(function (channelReply) {
            _this.Channels.rpcChannel = channelReply;
            _this.rpcQueue = Bus.rpcQueueBase + uuid.v4();
            return _this.Channels.rpcChannel.assertQueue(_this.rpcQueue, { durable: false, exclusive: true, autoDelete: true });
        })
            .then(function (okQueueReply) {
            return _this.Channels.rpcChannel.consume(_this.rpcQueue, function (msg) {
                if (_this.rpcResponseHandlers[msg.properties.correlationId]) {
                    _this.Channels.rpcChannel.ack(msg);
                    clearTimeout(_this.rpcResponseHandlers[msg.properties.correlationId].timeoutID);
                    var _msg = Bus.FromSubscription(msg);
                    _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                    _this.rpcResponseHandlers[msg.properties.correlationId].deferred.resolve(_msg);
                    delete _this.rpcResponseHandlers[msg.properties.correlationId];
                }
                else {
                }
            });
            return true;
        })
            .then(function (okSubscribeReply) {
            _this.rpcConsumerTag = okSubscribeReply.consumerTag;
            return true;
        });
        return this.rpcConsumerUp
            .then(function () { return _this.Channels.publishChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false }); })
            .then(function (okExchangeReply) { return _this.Channels.publishChannel.publish(Bus.rpcExchange, request.TypeID, Bus.ToBuffer(request), { type: request.TypeID, replyTo: _this.rpcQueue, correlationId: correlationID }); })
            .then(function (ackd) { return responseDeferred.promise; });
    };
    Bus.prototype.Respond = function (rqType, rsType, responder) {
        var _this = this;
        return this.Connection
            .then(function (connection) { return connection.createChannel(); })
            .then(function (responseChan) {
            return responseChan.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })
                .then(function (okExchangeReply) { return responseChan.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false }); })
                .then(function (okQueueReply) { return responseChan.bindQueue(rqType.TypeID, Bus.rpcExchange, rqType.TypeID); })
                .then(function (okBindReply) { return responseChan.consume(rqType.TypeID, function (reqMsg) {
                var msg = Bus.FromSubscription(reqMsg);
                if (reqMsg.properties.type === rqType.TypeID) {
                    msg.TypeID = msg.TypeID || reqMsg.properties.type; //so we can get non-BusMessage events
                    var replyTo = reqMsg.properties.replyTo;
                    var correlationID = reqMsg.properties.correlationId;
                    var ackdOrNackd = false;
                    responder(msg, {
                        ack: function () {
                            responseChan.ack(reqMsg);
                            ackdOrNackd = true;
                        },
                        nack: function () {
                            if (!reqMsg.fields.redelivered) {
                                responseChan.nack(reqMsg);
                            }
                            else {
                                //can only nack once
                                _this.SendToErrorQueue(msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        }
                    })
                        .then(function (response) {
                        _this.Channels.publishChannel.publish('', replyTo, Bus.ToBuffer(response), { type: rsType.TypeID, correlationId: correlationID });
                        if (!ackdOrNackd)
                            responseChan.ack(reqMsg);
                    });
                }
                else {
                    _this.SendToErrorQueue(msg, util.format('mismatched TypeID: %s !== %s', reqMsg.properties.type, rqType.TypeID));
                }
            })
                .then(function (ctag) {
                return {
                    cancelConsumer: function () {
                        return responseChan.cancel(ctag.consumerTag)
                            .then(function () { return true; })
                            .catch(function () { return false; });
                    },
                    deleteQueue: function () {
                        return responseChan.deleteQueue(rqType.TypeID)
                            .then(function () { return true; })
                            .catch(function () { return false; });
                    }
                };
            }); });
        });
    };
    // ========== Etc  ==========
    Bus.ToBuffer = function (obj) {
        Bus.remove$type(obj);
        return new Buffer(JSON.stringify(obj));
    };
    Bus.FromSubscription = function (obj) {
        //fields: "{"consumerTag":"amq.ctag-QreMJ-zvC07EW2EKtWZhmQ","deliveryTag":1,"redelivered":false,"exchange":"","routingKey":"easynetq.response.0303b47c-2229-4557-9218-30c99c67f8c9"}"
        //props:  "{"headers":{},"deliveryMode":1,"correlationId":"14ac579e-048b-4c30-b909-50841cce3e44","type":"Common.TestMessageRequestAddValueResponse:Findly"}"
        var msg = JSON.parse(obj.content.toString());
        Bus.remove$type(msg);
        return msg;
    };
    // ========== Extended ==========
    Bus.prototype.CancelConsumer = function (consumerTag) {
        return Promise.resolve(this.Channels.publishChannel.cancel(consumerTag));
    };
    Bus.prototype.DeleteExchange = function (exchange, ifUnused) {
        if (ifUnused === void 0) { ifUnused = false; }
        this.Channels.publishChannel.deleteExchange(exchange, { ifUnused: ifUnused });
    };
    Bus.prototype.DeleteQueue = function (queue, ifUnused, ifEmpty) {
        if (ifUnused === void 0) { ifUnused = false; }
        if (ifEmpty === void 0) { ifEmpty = false; }
        return Promise.resolve(this.Channels.publishChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty }));
    };
    Bus.prototype.DeleteQueueUnconditional = function (queue) {
        return Promise.resolve(this.Channels.publishChannel.deleteQueue(queue));
    };
    Bus.prototype.QueueStatus = function (queue) {
        return Promise.resolve(this.Channels.publishChannel.checkQueue(queue));
    };
    Bus.rpcExchange = 'easy_net_q_rpc';
    Bus.rpcQueueBase = 'easynetq.response.';
    Bus.defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
    Bus.remove$type = function (obj) {
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
    return Bus;
})();
exports.Bus = Bus;
//# sourceMappingURL=Bus.js.map