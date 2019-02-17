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
const uuid_1 = __importDefault(require("uuid"));
class ErrorQueueMessage {
    constructor(msg, err = "", stack = undefined) {
        this.TypeID = "Common.ErrorMessage:Messages";
        this.Message = JSON.stringify(msg);
        if (lodash_1.default.isError(err)) {
            this.Error = `${err.name}: ${err.message}`;
            this.Stack = lodash_1.default.isUndefined(err.stack) ? null : err.stack;
        }
        else {
            this.Error = err === "" ? null : err;
            this.Stack = lodash_1.default.isUndefined(stack) || stack === "" ? null : stack;
        }
    }
}
// ========================================================
class RabbitHutch {
    static CreateBus(config) {
        return __awaiter(this, void 0, void 0, function* () {
            const bus = new Bus(config);
            if (!(yield bus.Ready)) {
                throw "Bus failed to initialize";
            }
            return bus;
        });
    }
    static CreateExtendedBus(config) {
        return __awaiter(this, void 0, void 0, function* () {
            const bus = new ExtendedBus(config);
            if (!(yield bus.Ready)) {
                throw "Bus failed to initialize";
            }
            return bus;
        });
    }
}
exports.RabbitHutch = RabbitHutch;
class Bus {
    constructor(config) {
        this.config = config;
        try {
            this.Ready = (() => __awaiter(this, void 0, void 0, function* () {
                try {
                    const isMsgType = (candidate) => lodash_1.default.isObjectLike(candidate) && lodash_1.default.isString(candidate.TypeID) && candidate.TypeID.length > 0;
                    const dehydrateMsgType = (msg) => JSON.stringify(msg, (k, v) => k === "$type" ? undefined : v);
                    const hydratePayload = (payload) => {
                        const obj = JSON.parse(payload.toString(), (k, v) => k === "$type" ? undefined : v);
                        return isMsgType(obj) ? obj : null;
                    };
                    const toConsumerDispose = (channel, queueID, ctag) => {
                        return {
                            cancelConsumer: () => __awaiter(this, void 0, void 0, function* () {
                                try {
                                    yield channel.cancel(ctag.consumerTag);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            }),
                            deleteQueue: () => __awaiter(this, void 0, void 0, function* () {
                                try {
                                    yield channel.deleteQueue(queueID);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            }),
                            purgeQueue: () => __awaiter(this, void 0, void 0, function* () {
                                try {
                                    yield channel.purgeQueue(queueID);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            })
                        };
                    };
                    const vhost = config.vhost !== null ? `/${config.vhost}` : "";
                    const url = `${config.url}${vhost}?heartbeat=${config.heartbeat}`;
                    this.Connection = yield amqplib_1.default.connect(url);
                    // setup publish manager
                    const publishChannel = yield this.Connection.createConfirmChannel();
                    Object.defineProperty(this, "PublishChannel", { get() { return publishChannel; } });
                    publishChannel.on("close", (why) => {
                        // TODO - recreate channel and wipe exchanges?
                        console.log(why instanceof Error ? `error: ${why.name} - ${why.message}` : JSON.stringify(why));
                    });
                    const exchanges = new Set();
                    this.pubMgr = {
                        publish: (msg, routingKey = "") => __awaiter(this, void 0, void 0, function* () {
                            if (!isMsgType(msg)) {
                                return Promise.reject(`${JSON.stringify} is not a valid MsgType`);
                            }
                            try {
                                if (!exchanges.has(msg.TypeID)) {
                                    yield publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false });
                                    exchanges.add(msg.TypeID);
                                }
                                return yield publishChannel.publish(msg.TypeID, routingKey, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        }),
                        sendToQueue: (queue, msg) => __awaiter(this, void 0, void 0, function* () {
                            if (!isMsgType(msg)) {
                                return Promise.reject(`${JSON.stringify} is not a valid MsgType`);
                            }
                            try {
                                return yield publishChannel.sendToQueue(queue, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        })
                    };
                    // setup subscription manager
                    this.subMgr = {
                        hydratePayload: hydratePayload
                    };
                    // setup rpc manager
                    // setup rpc manager - responder
                    const responseChannel = yield this.Connection.createChannel();
                    yield responseChannel.prefetch(this.config.prefetch);
                    const responseQueue = `easynetq.response.${uuid_1.default.v4()}`;
                    yield responseChannel.assertQueue(responseQueue, { durable: false, exclusive: true, autoDelete: true });
                    const responseHandlers = new Map();
                    yield responseChannel.consume(responseQueue, msg => {
                        if (msg === null) {
                            // TODO - do something about null response message?
                            // log
                            return;
                        }
                        responseChannel.ack(msg);
                        const responseHandler = responseHandlers.get(msg.properties.correlationId);
                        if (lodash_1.default.isUndefined(responseHandler)) {
                            // TODO - do something about response for no handler
                            // log
                            return;
                        }
                        const _msg = hydratePayload(msg.content); // TODO - NO GOOD!!!!
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events - is this still valid?
                        responseHandler(_msg);
                    });
                    // setup rpc manager - requester
                    const rpcExchange = "easy_net_q_rpc";
                    yield publishChannel.assertExchange(rpcExchange, "direct", { durable: true, autoDelete: false });
                    this.rpcMgr = {
                        request: (rq) => __awaiter(this, void 0, void 0, function* () {
                            const corrID = uuid_1.default.v4();
                            let resolver;
                            let rejecter;
                            const responsePromise = new Promise((resolve, reject) => {
                                resolver = resolve;
                                rejecter = reject;
                            });
                            const onTimeout = _ => {
                                responseHandlers.delete(corrID);
                                rejecter(new Error(`Timed-out waiting for RPC response, correlationID: ${corrID}`));
                            };
                            const timeoutID = setTimeout(onTimeout, this.config.rpcTimeout || 30000);
                            const responseHdlr = (response) => {
                                clearTimeout(timeoutID);
                                resolver(response);
                                responseHandlers.delete(corrID);
                            };
                            responseHandlers.set(corrID, responseHdlr);
                            if (yield publishChannel.publish(rpcExchange, rq.TypeID, Buffer.from(dehydrateMsgType(rq)), { type: rq.TypeID, replyTo: responseQueue, correlationId: corrID })) {
                                return responsePromise;
                            }
                            else {
                                responseHandlers.delete(corrID);
                                return Promise.reject("Failed sending request");
                            }
                        }),
                        respond: (rqType, rsType, handler) => __awaiter(this, void 0, void 0, function* () {
                            const requestChannel = yield this.Connection.createChannel();
                            yield requestChannel.prefetch(this.config.prefetch);
                            yield requestChannel.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false });
                            yield requestChannel.bindQueue(rqType.TypeID, rpcExchange, rqType.TypeID);
                            const ctag = yield requestChannel.consume(rqType.TypeID, (rq) => __awaiter(this, void 0, void 0, function* () {
                                if (rq === null) {
                                    // TODO - do something about null response message?
                                    // log
                                    return;
                                }
                                const _msg = this.subMgr.hydratePayload(rq.content); // TODO - NO GOOD!!!!
                                if (rq.properties.type !== rqType.TypeID) {
                                    // log
                                    this.SendToErrorQueue(_msg, `mismatched TypeID: ${rq.properties.type} != ${rqType.TypeID}`);
                                    return;
                                }
                                _msg.TypeID = _msg.TypeID || rq.properties.type; //so we can get non-BusMessage events - is this still valid?
                                let ackdOrNackd = false;
                                let deferred = false;
                                let deferTimeout;
                                const ack = () => {
                                    if (deferred)
                                        clearTimeout(deferTimeout);
                                    requestChannel.ack(rq);
                                    ackdOrNackd = true;
                                };
                                const nack = () => {
                                    if (deferred)
                                        clearTimeout(deferTimeout);
                                    if (!rq.fields.redelivered) {
                                        requestChannel.nack(rq);
                                    }
                                    else {
                                        //can only nack once
                                        this.SendToErrorQueue(_msg, "attempted to nack previously nack'd message");
                                    }
                                    ackdOrNackd = true;
                                };
                                const response = yield handler(_msg, {
                                    ack: ack,
                                    nack: nack,
                                    defer: (guard = Bus.defaultDeferredAckTimeout) => {
                                        if (lodash_1.default.isNumber(guard)) {
                                            if (!lodash_1.default.isSafeInteger(guard)) {
                                                // TODO - do what?
                                            }
                                            deferTimeout = setTimeout(nack, guard);
                                        }
                                        else {
                                            guard().then(success => success ? ack() : nack());
                                        }
                                        deferred = true;
                                    }
                                });
                                publishChannel.publish("", rq.properties.replyTo, Buffer.from(dehydrateMsgType(response)), { type: rsType.TypeID, correlationId: rq.properties.correlationId });
                                if (!ackdOrNackd && !deferred)
                                    requestChannel.ack(rq);
                            }));
                            return toConsumerDispose(requestChannel, rqType.TypeID, ctag);
                        })
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
        return this.pubMgr.publish(msg, withTopic);
    }
    Subscribe(type, subscriberName, handler, withTopic = '#') {
        return __awaiter(this, void 0, void 0, function* () {
            const queueID = `${lodash_1.default.defaultTo(type.TypeID, "")}_${subscriberName}`;
            if (queueID.length === subscriberName.length + 1) {
                return Promise.reject(`${type.TypeID} is not a valid TypeID`);
            }
            const channel = yield this.Connection.createChannel();
            yield channel.prefetch(this.config.prefetch);
            yield channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false });
            yield channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false });
            yield channel.bindQueue(queueID, type.TypeID, withTopic);
            const ctag = yield channel.consume(queueID, (msg) => {
                // TODO - why would this equal null?
                if (msg !== null) {
                    const _msg = this.subMgr.hydratePayload(msg.content); // TODO - NO GOOD!!!!
                    if (msg.properties.type === type.TypeID) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events - is this still valid?
                        let ackdOrNackd = false;
                        let deferred = false;
                        let deferTimeout;
                        const ack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            channel.ack(msg);
                            ackdOrNackd = true;
                        };
                        const nack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, "attempted to nack previously nack'd message");
                            }
                            ackdOrNackd = true;
                        };
                        handler(_msg, {
                            ack: ack,
                            nack: nack,
                            defer: (guard = Bus.defaultDeferredAckTimeout) => {
                                if (lodash_1.default.isNumber(guard)) {
                                    if (!lodash_1.default.isSafeInteger(guard)) {
                                        // TODO - do what?
                                    }
                                    deferTimeout = setTimeout(nack, guard);
                                }
                                else {
                                    guard().then(success => success ? ack() : nack());
                                }
                                deferred = true;
                            }
                        });
                        if (!ackdOrNackd && !deferred)
                            channel.ack(msg);
                    }
                    else {
                        this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} != ${type.TypeID}`);
                    }
                }
            });
            return {
                cancelConsumer: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.cancel(ctag.consumerTag);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                deleteQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.deleteQueue(queueID);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                purgeQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.purgeQueue(queueID);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                })
            };
        });
    }
    // ========== Send / Receive ==========
    Send(queue, msg) {
        return this.pubMgr.sendToQueue(queue, msg);
    }
    Receive(rxType, queue, handler) {
        return __awaiter(this, void 0, void 0, function* () {
            const channel = yield this.Connection.createChannel();
            yield channel.prefetch(this.config.prefetch);
            yield channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            const ctag = yield channel.consume(queue, msg => {
                // TODO - why would this equal null?
                if (msg !== null) {
                    const _msg = this.subMgr.hydratePayload(msg.content); // TODO - NO GOOD!!!!
                    if (msg.properties.type === rxType.TypeID) {
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events - is this still valid?
                        let ackdOrNackd = false;
                        let deferred = false;
                        let deferTimeout;
                        const ack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            channel.ack(msg);
                            ackdOrNackd = true;
                        };
                        const nack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, "attempted to nack previously nack'd message");
                            }
                            ackdOrNackd = true;
                        };
                        handler(_msg, {
                            ack: ack,
                            nack: nack,
                            defer: (guard = Bus.defaultDeferredAckTimeout) => {
                                if (lodash_1.default.isNumber(guard)) {
                                    if (!lodash_1.default.isSafeInteger(guard)) {
                                        // TODO - do what?
                                    }
                                    deferTimeout = setTimeout(nack, guard);
                                }
                                else {
                                    guard().then(success => success ? ack() : nack());
                                }
                                deferred = true;
                            }
                        });
                        if (!ackdOrNackd && !deferred)
                            channel.ack(msg);
                    }
                    else {
                        this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} != ${rxType.TypeID}`);
                    }
                }
            });
            return {
                cancelConsumer: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.cancel(ctag.consumerTag);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                deleteQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.deleteQueue(queue);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                purgeQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.purgeQueue(queue);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                })
            };
        });
    }
    ReceiveTypes(queue, handlerDefinitions) {
        return __awaiter(this, void 0, void 0, function* () {
            const channel = yield this.Connection.createChannel();
            yield channel.prefetch(this.config.prefetch);
            yield channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
            const ctag = yield channel.consume(queue, msg => {
                // TODO - why would this equal null?
                if (msg !== null) {
                    const _msg = this.subMgr.hydratePayload(msg.content); // TODO - NO GOOD!!!!
                    let msgHandled = false;
                    handlerDefinitions
                        .filter(hdlrDef => hdlrDef.rxType.TypeID === msg.properties.type)
                        .map(hdlrDef => hdlrDef.handler)
                        .forEach(handler => {
                        msgHandled = true;
                        _msg.TypeID = _msg.TypeID || msg.properties.type; //so we can get non-BusMessage events - is this still valid?
                        let ackdOrNackd = false;
                        let deferred = false;
                        let deferTimeout;
                        const ack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            channel.ack(msg);
                            ackdOrNackd = true;
                        };
                        const nack = () => {
                            if (deferred)
                                clearTimeout(deferTimeout);
                            if (!msg.fields.redelivered) {
                                channel.nack(msg);
                            }
                            else {
                                //can only nack once
                                this.SendToErrorQueue(_msg, "attempted to nack previously nack'd message");
                            }
                            ackdOrNackd = true;
                        };
                        handler(_msg, {
                            ack: ack,
                            nack: nack,
                            defer: (guard = Bus.defaultDeferredAckTimeout) => {
                                if (lodash_1.default.isNumber(guard)) {
                                    if (!lodash_1.default.isSafeInteger(guard)) {
                                        // TODO - do what?
                                    }
                                    deferTimeout = setTimeout(nack, guard);
                                }
                                else {
                                    guard().then(success => success ? ack() : nack());
                                }
                                deferred = true;
                            }
                        });
                        if (!ackdOrNackd && !deferred)
                            channel.ack(msg);
                    });
                    if (!msgHandled) {
                        this.SendToErrorQueue(_msg, `message with unhandled TypeID: ${msg.properties.type}`);
                    }
                }
            });
            return {
                cancelConsumer: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.cancel(ctag.consumerTag);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                deleteQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.deleteQueue(queue);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                }),
                purgeQueue: () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield channel.purgeQueue(queue);
                        return true;
                    }
                    catch (e) {
                        return false;
                    }
                })
            };
        });
    }
    // ========== Request / Response ==========
    Request(request) {
        return this.rpcMgr.request(request);
    }
    // should this have a name for competing consumer?
    Respond(rqType, rsType, handler) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO - a bit much, Michael vvv..... isMsgType
            const rejectedTypes = [rqType, rsType]
                .filter(t => !(lodash_1.default.isString(t.TypeID) && t.TypeID.length > 0))
                .map((_, idx) => `${idx === 0 ? "request" : "respond"} TypeID is invalid`)
                .join(", ");
            if (rejectedTypes.length > 0) {
                return Promise.reject(rejectedTypes);
            }
            return this.rpcMgr.respond(rqType, rsType, handler);
        });
    }
    RespondAsync(rqType, rsType, handler) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO - a bit much, Michael vvv..... isMsgType
            const rejectedTypes = [rqType, rsType]
                .filter(t => !(lodash_1.default.isString(t.TypeID) && t.TypeID.length > 0))
                .map((_, idx) => `${idx === 0 ? "request" : "respond"} TypeID is invalid`)
                .join(", ");
            if (rejectedTypes.length > 0) {
                return Promise.reject(rejectedTypes);
            }
            return this.rpcMgr.respond(rqType, rsType, handler);
        });
    }
    SendToErrorQueue(msg, err = "", stack = "") {
        const errQueueMsg = lodash_1.default.isError(err) ? new ErrorQueueMessage(msg, err) : new ErrorQueueMessage(msg, err, stack);
        return this.Send(Bus.defaultErrorQueue, errQueueMsg);
    }
}
Bus.defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
Bus.defaultDeferredAckTimeout = 10000;
class ExtendedBus extends Bus {
    constructor(config) {
        super(config);
    }
    CancelConsumer(consumerTag) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.PublishChannel.cancel(consumerTag);
                return true;
            }
            catch (e) {
                return false;
            }
        });
    }
    DeleteExchange(exchange, ifUnused = false) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.PublishChannel.deleteExchange(exchange, { ifUnused: ifUnused });
                return true;
            }
            catch (e) {
                return false;
            }
        });
    }
    DeleteQueue(queue, ifUnused = false, ifEmpty = false) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.PublishChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty });
            }
            catch (e) {
                let error = `Failed deleting queue ${queue}`;
                if (lodash_1.default.isError(e)) {
                    error = `${error} - ${e.name}: ${e.message}`;
                }
                return Promise.reject(error);
            }
        });
    }
    DeleteQueueUnconditional(queue) {
        return this.DeleteQueue(queue, false, false);
    }
    QueueStatus(queue) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.PublishChannel.checkQueue(queue);
            }
            catch (e) {
                let error = `Failed retrieving status for ${queue}`;
                if (lodash_1.default.isError(e)) {
                    error = `${error} - ${e.name}: ${e.message}`;
                }
                return Promise.reject(error);
            }
        });
    }
    PurgeQueue(queue) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.PublishChannel.purgeQueue(queue);
            }
            catch (e) {
                let error = `Failed purging queue ${queue}`;
                if (lodash_1.default.isError(e)) {
                    error = `${error} - ${e.name}: ${e.message}`;
                }
                return Promise.reject(error);
            }
        });
    }
}
exports.ExtendedBus = ExtendedBus;
/*
interface Message {
    content: Buffer;
    fields: MessageFields;
    properties: MessageProperties;
    fields: {
        deliveryTag: number;
        redelivered: boolean;
        exchange: string;
        routingKey: string;
    }
}

ConsumeMessage extends Message {
    content: Buffer;
    fields: {
        messageCount?: number;
        consumerTag?: string;
        deliveryTag: number;
        redelivered: boolean;
        exchange: string;
        routingKey: string;
    }
    properties: {
        contentType: any | undefined;
        contentEncoding: any | undefined;
        headers: {
            "x-first-death-exchange"?: string;
            "x-first-death-queue"?: string;
            "x-first-death-reason"?: string;
            "x-death"?: XDeath[];
            [key: string]: any;
        }
        deliveryMode: any | undefined;
        priority: any | undefined;
        correlationId: any | undefined;
        replyTo: any | undefined;
        expiration: any | undefined;
        messageId: any | undefined;
        timestamp: any | undefined;
        type: any | undefined;
        userId: any | undefined;
        appId: any | undefined;
        clusterId: any | undefined;
    }
}
*/
//# sourceMappingURL=bus.js.map