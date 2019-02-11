"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const amqplib_1 = __importDefault(require("amqplib"));
const lodash_1 = __importDefault(require("lodash"));
const util_1 = __importDefault(require("util"));
const uuid_1 = __importDefault(require("uuid"));
const isMsgType = (candidate) => lodash_1.default.isObjectLike(candidate) && lodash_1.default.isString(candidate.TypeID) && candidate.TypeID.length > 0;
// ========================================================
class RabbitHutch {
    static CreateBus(config) {
        const bus = new Bus(config);
        return bus;
    }
    static CreateExtendedBus(config) {
        var bus = new ExtendedBus(config);
        return bus;
    }
}
exports.RabbitHutch = RabbitHutch;
class Bus {
    constructor(config) {
        this.config = config;
        this.rpcQueue = null;
        // private rpcConsumerTag: Promise<IQueueConsumeReply>;
        this.rpcResponseHandlers = {};
        try {
            this.Ready = (() => __awaiter(this, void 0, void 0, function* () {
                try {
                    const vhost = config.vhost !== null ? `/${config.vhost}` : "";
                    const url = `${config.url}${vhost}?heartbeat=${config.heartbeat}`;
                    this.Connection = yield amqplib_1.default.connect(url);
                    this.Channels.publishChannel = yield this.Connection.createConfirmChannel();
                    const dehydrateMsgType = (msg) => JSON.stringify(msg, (k, v) => k === "$type" ? undefined : v);
                    const hydratePayload = (payload) => {
                        const obj = JSON.parse(payload.toString(), (k, v) => k === "$type" ? undefined : v);
                        return isMsgType(obj) ? obj : null;
                    };
                    this.pubMgr = (() => {
                        this.Channels.publishChannel.on("close", (why) => {
                            // TODO - recreate channel and wipe exchanges?
                            console.log(why instanceof Error ? `error: ${why.name} - ${why.message}` : JSON.stringify(why));
                        });
                        const exchanges = new Set();
                        const publish = (msg, routingKey = "") => __awaiter(this, void 0, void 0, function* () {
                            try {
                                if (!exchanges.has(msg.TypeID)) {
                                    yield this.Channels.publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false });
                                    exchanges.add(msg.TypeID);
                                }
                                return yield this.Channels.publishChannel.publish(msg.TypeID, routingKey, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        });
                        const sendToQueue = (queue, msg) => __awaiter(this, void 0, void 0, function* () {
                            try {
                                return yield this.Channels.publishChannel.sendToQueue(queue, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        });
                        return {
                            publish: publish,
                            sendToQueue: sendToQueue
                        };
                    })();
                    this.subMgr = {
                        hydratePayload: hydratePayload
                    };
                    return true;
                }
                catch (e) {
                    // TODO: logger?
                    return false;
                }
            }))();
        }
        catch (e) {
            console.log('[ERROR] - Connection problem %s', e);
        }
    }
    // ========== Publish / Subscribe ==========
    Publish(msg, withTopic = "") {
        return __awaiter(this, void 0, void 0, function* () {
            if (!isMsgType(msg)) {
                return Promise.reject(`${JSON.stringify} is not a valid MsgType`);
            }
            return yield this.pubMgr.publish(msg, withTopic);
        });
    }
    // public async Publish(msg: { TypeID: string }, withTopic: string = ''): Promise<boolean> {
    //     if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
    //         return Promise.reject<boolean>(util.format('%s is not a valid TypeID', msg.TypeID));
    //     }
    //     return this.pubChanUp
    //         .then(() => this.Channels.publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false }))
    //         .then((okExchangeReply) => this.Channels.publishChannel.publish(msg.TypeID, withTopic, Bus.ToBuffer(msg), { type: msg.TypeID }));
    // }
    Subscribe(type, subscriberName, handler, withTopic = '#') {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof type.TypeID !== 'string' || type.TypeID.length === 0) {
                return Promise.reject(util_1.default.format('%s is not a valid TypeID', type.TypeID));
            }
            if (typeof handler !== 'function') {
                return Promise.reject('xyz is not a valid function');
            }
            const queueID = `${type.TypeID}_${subscriberName}`;
            const channel = yield (yield this.Connection).createChannel();
            channel.prefetch(this.config.prefetch); //why do we prefetch here and not wait on the promise?
            yield channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false });
            yield channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false });
            yield channel.bindQueue(queueID, type.TypeID, withTopic);
            const ctag = yield channel.consume(queueID, (msg) => {
                // TODO - why would this equal null?
                if (msg !== null) {
                    const _msg = this.subMgr.hydratePayload(msg.content); // TODO - NO GOOD!!!!
                    if (msg.properties.type === type.TypeID) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events - is this still valid?
                        var ackdOrNackd = false;
                        var deferred = false;
                        var deferTimeout;
                        const nackIfFirstDeliveryElseSendToErrorQueue = () => {
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        };
                        handler(_msg, {
                            ack: () => {
                                if (deferred)
                                    clearTimeout(deferTimeout);
                                channel.ack(msg);
                                ackdOrNackd = true;
                            },
                            nack: () => {
                                if (deferred)
                                    clearTimeout(deferTimeout);
                                nackIfFirstDeliveryElseSendToErrorQueue();
                            },
                            defer: (timeout = Bus.defaultDeferredAckTimeout) => {
                                deferred = true;
                                deferTimeout = setTimeout(() => {
                                    nackIfFirstDeliveryElseSendToErrorQueue();
                                }, timeout);
                            },
                        });
                        if (!ackdOrNackd && !deferred)
                            channel.ack(msg);
                    }
                    else {
                        this.SendToErrorQueue(_msg, util_1.default.format('mismatched TypeID: %s !== %s', msg.properties.type, type.TypeID));
                    }
                }
            });
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
                                var deferred = false;
                                var deferTimeout;
                                const nackIfFirstDeliveryElseSendToErrorQueue = () => {
                                    if (!msg.fields.redelivered) {
                                        channel.nack(msg);
                                    }
                                    else {
                                        //can only nack once
                                        this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                    }
                                    ackdOrNackd = true;
                                };
                                handler(_msg, {
                                    ack: () => {
                                        if (deferred)
                                            clearTimeout(deferTimeout);
                                        channel.ack(msg);
                                        ackdOrNackd = true;
                                    },
                                    nack: () => {
                                        if (deferred)
                                            clearTimeout(deferTimeout);
                                        nackIfFirstDeliveryElseSendToErrorQueue();
                                    },
                                    defer: (timeout = Bus.defaultDeferredAckTimeout) => {
                                        deferred = true;
                                        deferTimeout = setTimeout(() => {
                                            nackIfFirstDeliveryElseSendToErrorQueue();
                                        }, timeout);
                                    },
                                });
                                if (!ackdOrNackd && !deferred)
                                    channel.ack(msg);
                            }
                            else {
                                this.SendToErrorQueue(_msg, util_1.default.format('mismatched TypeID: %s !== %s', msg.properties.type, type.TypeID));
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
                            },
                            purgeQueue: () => {
                                return channel.purgeQueue(queueID)
                                    .then(() => true)
                                    .catch(() => false);
                            }
                        };
                    });
                });
            });
        });
    }
    // ========== Send / Receive ==========
    Send(queue, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!isMsgType(msg)) {
                return Promise.reject(`${JSON.stringify} is not a valid MsgType`);
            }
            return yield this.pubMgr.sendToQueue(queue, msg);
        });
    }
    // public Send(queue: string, msg: { TypeID: string }): Promise<boolean> {
    //     if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
    //         return Promise.reject<boolean>(util.format('%s is not a valid TypeID', JSON.stringify(msg.TypeID)));
    //     }
    //     return this.pubChanUp
    //         .then(() => this.Channels.publishChannel.sendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID }));
    // }
    // public Receive(rxType: { TypeID: string }, queue: string, handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void; defer: () => void }) => void): Promise<IConsumerDispose>
    Receive(rxType, queue, handler) {
        var channel = null;
        return this.Connection.then((connection) => {
            return Promise.resolve(connection.createChannel())
                .then((chanReply) => {
                channel = chanReply;
                channel.prefetch(this.config.prefetch);
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then((okQueueReply) => channel.consume(queue, (msg) => {
                if (msg) {
                    var _msg = Bus.FromSubscription(msg);
                    if (msg.properties.type === rxType.TypeID) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                        var ackdOrNackd = false;
                        var deferred = false;
                        var deferTimeout;
                        const nackIfFirstDeliveryElseSendToErrorQueue = () => {
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                            }
                            ackdOrNackd = true;
                        };
                        handler(_msg, {
                            ack: () => {
                                if (deferred)
                                    clearTimeout(deferTimeout);
                                channel.ack(msg);
                                ackdOrNackd = true;
                            },
                            nack: () => {
                                if (deferred)
                                    clearTimeout(deferTimeout);
                                nackIfFirstDeliveryElseSendToErrorQueue();
                            },
                            defer: (timeout = Bus.defaultDeferredAckTimeout) => {
                                deferred = true;
                                deferTimeout = setTimeout(() => {
                                    nackIfFirstDeliveryElseSendToErrorQueue();
                                }, timeout);
                            },
                        });
                        if (!ackdOrNackd && !deferred)
                            channel.ack(msg);
                    }
                    else {
                        this.SendToErrorQueue(_msg, util_1.default.format('mismatched TypeID: %s !== %s', msg.properties.type, rxType.TypeID));
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
                    },
                    purgeQueue: () => {
                        return channel.purgeQueue(queue)
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
                channel.prefetch(this.config.prefetch);
                return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            })
                .then((okQueueReply) => channel.consume(queue, (msg) => {
                var _msg = Bus.FromSubscription(msg);
                handlers.filter((handler) => handler.rxType.TypeID === msg.properties.type).forEach((handler) => {
                    _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                    var ackdOrNackd = false;
                    var deferred = false;
                    var deferTimeout;
                    const nackIfFirstDeliveryElseSendToErrorQueue = () => {
                        if (!msg.fields.redelivered) {
                            channel.nack(msg);
                        }
                        else {
                            //can only nack once
                            this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                        }
                        ackdOrNackd = true;
                    };
                    handler.handler(_msg, {
                        ack: () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            channel.ack(msg);
                            ackdOrNackd = true;
                        },
                        nack: () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            nackIfFirstDeliveryElseSendToErrorQueue();
                        },
                        defer: (timeout = Bus.defaultDeferredAckTimeout) => {
                            deferred = true;
                            deferTimeout = setTimeout(() => {
                                nackIfFirstDeliveryElseSendToErrorQueue();
                            }, timeout);
                        },
                    });
                    if (!ackdOrNackd && !deferred)
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
                    },
                    purgeQueue: () => {
                        return channel.purgeQueue(queue)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    // ========== Request / Response ==========
    Request(request) {
        let resolver;
        let rejecter;
        var responsePromise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
        });
        var correlationID = uuid_1.default.v4();
        this.rpcResponseHandlers[correlationID] = {
            resolver: resolver,
            rejecter: rejecter,
            timeoutID: setTimeout(() => {
                delete this.rpcResponseHandlers[correlationID];
                throw Error('Timed-out waiting for RPC response, correlationID: ' + correlationID);
            }, this.config.rpcTimeout || 30000)
        };
        this.rpcConsumerUp = this.rpcConsumerUp || this.Connection
            .then((connection) => connection.createChannel())
            .then((channelReply) => {
            this.Channels.rpcChannel = channelReply;
            this.rpcQueue = Bus.rpcQueueBase + uuid_1.default.v4();
            return this.Channels.rpcChannel.assertQueue(this.rpcQueue, { durable: false, exclusive: true, autoDelete: true });
        })
            .then((okQueueReply) => {
            return this.Channels.rpcChannel.consume(this.rpcQueue, (msg) => {
                if (this.rpcResponseHandlers[msg.properties.correlationId]) {
                    this.Channels.rpcChannel.ack(msg);
                    clearTimeout(this.rpcResponseHandlers[msg.properties.correlationId].timeoutID);
                    var _msg = Bus.FromSubscription(msg);
                    _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events
                    this.rpcResponseHandlers[msg.properties.correlationId].resolver(_msg);
                    delete this.rpcResponseHandlers[msg.properties.correlationId];
                }
                else {
                    //ignore it?
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
            .then((ackd) => responsePromise);
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
                    this.SendToErrorQueue(msg, util_1.default.format('mismatched TypeID: %s !== %s', reqMsg.properties.type, rqType.TypeID));
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
                    },
                    purgeQueue: () => {
                        return responseChan.purgeQueue(rqType.TypeID)
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
                    this.SendToErrorQueue(msg, util_1.default.format('mismatched TypeID: %s !== %s', reqMsg.properties.type, rqType.TypeID));
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
                    },
                    purgeQueue: () => {
                        return responseChan.purgeQueue(rqType.TypeID)
                            .then(() => true)
                            .catch(() => false);
                    }
                };
            }));
        });
    }
    // TODO: handle error for msg (can't stringify error)
    SendToErrorQueue(msg, err = '', stack = '') {
        const errMsg = {
            TypeID: 'Common.ErrorMessage:Messages',
            Message: msg === void 0 ? null : JSON.stringify(msg),
            Error: err === void 0 ? null : err,
            Stack: stack === void 0 ? null : stack
        };
        return this.pubChanUp
            .then(() => this.Channels.publishChannel.assertQueue(Bus.defaultErrorQueue, { durable: true, exclusive: false, autoDelete: false }))
            .then(() => this.Send(Bus.defaultErrorQueue, errMsg));
    }
}
Bus.rpcExchange = 'easy_net_q_rpc';
Bus.rpcQueueBase = 'easynetq.response.';
Bus.defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
Bus.defaultDeferredAckTimeout = 10000;
class ExtendedBus extends Bus {
    constructor(config) {
        super(config);
    }
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
    PurgeQueue(queue) {
        return Promise.resolve(this.Channels.publishChannel.purgeQueue(queue));
    }
}
exports.ExtendedBus = ExtendedBus;
//# sourceMappingURL=bus.js.map