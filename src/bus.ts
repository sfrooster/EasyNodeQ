import amqp from "amqplib";
import _ from "lodash";
import uuid from "uuid";


// ========================================================
interface MsgType {
    TypeID: string;
}

class ErrorQueueMessage implements MsgType {
    public readonly TypeID = "Common.ErrorMessage:Messages";

    public readonly Message: string;
    public readonly Error: string | null;
    public readonly Stack: string | null;

    constructor(msg: MsgType);
    constructor(msg: MsgType, err: Error | string);
    constructor(msg: MsgType, err: string, stack: string);
    constructor(msg: MsgType, err: Error | string = "", stack: string | undefined = undefined) {
        this.Message = JSON.stringify(msg);

        if (_.isError(err)) {
            this.Error = `${err.name}: ${err.message}`;
            this.Stack = _.isUndefined(err.stack) ? null : err.stack;
        }
        else {
            this.Error = err === "" ? null : err;
            this.Stack = _.isUndefined(stack) || stack === "" ? null : stack;
        }
    }
}

type deferGuardType = number | (() => Promise<boolean>);

interface AckExts {
    ack(): void;
    nack(): void;
    defer(guard: deferGuardType): void;
}

type AsyncMsgFunctionExt = <T extends Promise<MsgType>>(msg: MsgType, ackFns: AckExts) => T;
type SyncMsgFunctionExt = <T extends MsgType>(msg: MsgType, ackFns: AckExts) => T;
type MsgFunctionExt = <T extends MsgType | Promise<MsgType>>(msg: MsgType, ackFns: AckExts) => T;

type MsgHandlerExt = (msg: MsgType, ackFns: AckExts) => void;

type ResponseHandler = (response: MsgType) => void;
// ========================================================

export class RabbitHutch {
    public static async CreateBus(config: IBusConfig): Promise<IBus> {
        const bus = new Bus(config);
        if (!await bus.Ready) {
            throw "Bus failed to initialize";
        }
        return bus;
    }

    public static async CreateExtendedBus(config: IBusConfig): Promise<IExtendedBus> {
        const bus = new ExtendedBus(config);
        if (!await bus.Ready) {
            throw "Bus failed to initialize";
        }
        return bus;
    }
}

class Bus implements IBus {
    private static defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
    private static defaultDeferredAckTimeout = 10000;

    private Connection: amqp.Connection;

    private pubMgr: {
        publish(msg: MsgType, routingKey: string): Promise<boolean>;
        sendToQueue(queue: string, msg: MsgType): Promise<boolean>;
    }

    private subMgr: {
        hydratePayload(payload: Buffer): MsgType | null;
    }

    private rpcMgr: {
        request<T extends MsgType>(rq: MsgType): Promise<T>;
        respond(rqType: MsgType, rsType: MsgType, handler: MsgFunctionExt): Promise<IConsumer>;
    }

    protected readonly PublishChannel: amqp.Channel;

    public readonly Ready: PromiseLike<boolean>;


    constructor(public config: IBusConfig) {
        try {
            this.Ready = (async () => {
                try {
                    const isMsgType = (candidate: any): candidate is MsgType => _.isObjectLike(candidate) && _.isString(candidate.TypeID) && candidate.TypeID.length > 0;

                    const dehydrateMsgType = (msg: MsgType) => JSON.stringify(msg, (k, v) => k === "$type" ? undefined : v);

                    const hydratePayload = (payload: Buffer) => {
                        const obj = JSON.parse(payload.toString(), (k, v) => k === "$type" ? undefined : v);
                        return isMsgType(obj) ? obj : null;
                    };

                    const toConsumerDispose = (channel: amqp.Channel, queueID: string, ctag: amqp.Replies.Consume) => {
                        return {
                            cancelConsumer: async () => {
                                try {
                                    await channel.cancel(ctag.consumerTag);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            },
                            deleteQueue: async () => {
                                try {
                                    await channel.deleteQueue(queueID);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            },
                            purgeQueue: async () => {
                                try {
                                    await channel.purgeQueue(queueID);
                                    return true;
                                }
                                catch (e) {
                                    return false;
                                }
                            }
                        } as IConsumer;
                    };

                    const vhost = config.vhost !== null ? `/${config.vhost}` : "";
                    const url = `${config.url}${vhost}?heartbeat=${config.heartbeat}`;

                    this.Connection = await amqp.connect(url);


                    // setup publish manager
                    const publishChannel = await this.Connection.createConfirmChannel();
                    Object.defineProperty(this, "PublishChannel", { get() { return publishChannel; }});

                    publishChannel.on("close", (why) => {
                        // TODO - recreate channel and wipe exchanges?
                        console.log(why instanceof Error ? `error: ${why.name} - ${why.message}` : JSON.stringify(why));
                    });

                    const exchanges = new Set<string>();

                    this.pubMgr = {
                        publish: async (msg: MsgType, routingKey: string = "") => {
                            if (!isMsgType(msg)) {
                                return Promise.reject<boolean>(`${JSON.stringify} is not a valid MsgType`);
                            }

                            try {
                                if (!exchanges.has(msg.TypeID)) {
                                    await publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false });
                                    exchanges.add(msg.TypeID);
                                }
                                return await publishChannel.publish(msg.TypeID, routingKey, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        },
                        sendToQueue: async (queue: string, msg: MsgType) => {
                            if (!isMsgType(msg)) {
                                return Promise.reject<boolean>(`${JSON.stringify} is not a valid MsgType`);
                            }

                            try {
                                return await publishChannel.sendToQueue(queue, Buffer.from(dehydrateMsgType(msg)), { type: msg.TypeID });
                            }
                            catch (e) {
                                // TODO: logger?
                                console.log(`error: ${e.name} - ${e.message}`);
                                return false;
                            }
                        }
                    };


                    // setup subscription manager
                    this.subMgr = {
                        hydratePayload: hydratePayload
                    };


                    // setup rpc manager
                    // setup rpc manager - responder
                    const responseChannel = await this.Connection.createChannel();
                    await responseChannel.prefetch(this.config.prefetch);

                    const responseQueue = `easynetq.response.${uuid.v4()}`;
                    await responseChannel.assertQueue(responseQueue, { durable: false, exclusive: true, autoDelete: true });

                    const responseHandlers = new Map<string, ResponseHandler>();

                    await responseChannel.consume(responseQueue, msg => {
                        if (msg === null) {
                            // TODO - do something about null response message?
                            // log
                            return;
                        }

                        responseChannel.ack(msg);

                        const responseHandler = responseHandlers.get(msg.properties.correlationId);

                        if (_.isUndefined(responseHandler)) {
                            // TODO - do something about response for no handler
                            // log
                            return;
                        }

                        const _msg = hydratePayload(msg.content)!; // TODO - NO GOOD!!!!
                        _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events - is this still valid?

                        responseHandler(_msg);
                    });


                    // setup rpc manager - requester
                    const rpcExchange = "easy_net_q_rpc";
                    await publishChannel.assertExchange(rpcExchange, "direct", { durable: true, autoDelete: false });

                    this.rpcMgr = {
                        request: async<T extends MsgType>(rq: MsgType) => {
                            const corrID = uuid.v4();

                            let resolver: (response: T) => void;
                            let rejecter: (reason: string | Error) => void;
                            const responsePromise = new Promise<T>((resolve, reject) => {
                                resolver = resolve;
                                rejecter = reject;
                            });

                            const onTimeout = _ => {
                                responseHandlers.delete(corrID);
                                rejecter(new Error(`Timed-out waiting for RPC response, correlationID: ${corrID}`));
                            };
                            const timeoutID = setTimeout(onTimeout, this.config.rpcTimeout || 30000);

                            const responseHdlr: ResponseHandler = (response: T) => {
                                clearTimeout(timeoutID);
                                resolver(response);
                                responseHandlers.delete(corrID);
                            };

                            responseHandlers.set(corrID, responseHdlr);

                            if (await publishChannel.publish(rpcExchange, rq.TypeID, Buffer.from(dehydrateMsgType(rq)), { type: rq.TypeID, replyTo: responseQueue, correlationId: corrID })) {
                                return responsePromise;
                            }
                            else {
                                responseHandlers.delete(corrID);
                                return Promise.reject<T>("Failed sending request");
                            }
                        },
                        respond: async (rqType: MsgType, rsType: MsgType, handler: MsgFunctionExt) => {
                            const requestChannel = await this.Connection.createChannel();

                            await requestChannel.prefetch(this.config.prefetch);
                            await requestChannel.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false });
                            await requestChannel.bindQueue(rqType.TypeID, rpcExchange, rqType.TypeID);

                            const ctag = await requestChannel.consume(rqType.TypeID, async(rq) => {
                                if (rq === null) {
                                    // TODO - do something about null response message?
                                    // log
                                    return;
                                }

                                const _msg = this.subMgr.hydratePayload(rq.content)!; // TODO - NO GOOD!!!!

                                if (rq.properties.type !== rqType.TypeID) {
                                    // log
                                    this.SendToErrorQueue(_msg, `mismatched TypeID: ${rq.properties.type} != ${rqType.TypeID}`);
                                    return;
                                }

                                _msg.TypeID = _msg.TypeID || rq.properties.type;  //so we can get non-BusMessage events - is this still valid?

                                let ackdOrNackd = false;
                                let deferred = false;
                                let deferTimeout: NodeJS.Timeout;

                                const ack = () => {
                                    if (deferred) clearTimeout(deferTimeout);
                                    requestChannel.ack(rq);
                                    ackdOrNackd = true;
                                };

                                const nack = () => {
                                    if (deferred) clearTimeout(deferTimeout);
                                    if (!rq.fields.redelivered) {
                                        requestChannel.nack(rq);
                                    }
                                    else {
                                        //can only nack once
                                        this.SendToErrorQueue(_msg, "attempted to nack previously nack'd message");
                                    }
                                    ackdOrNackd = true;
                                };

                                const response = await handler(_msg, {
                                    ack: ack,
                                    nack: nack,
                                    defer: (guard = Bus.defaultDeferredAckTimeout) => {
                                        if (_.isNumber(guard)) {
                                            if (!_.isSafeInteger(guard)) {
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
                                if (!ackdOrNackd && !deferred) requestChannel.ack(rq);
                            });

                            return toConsumerDispose(requestChannel, rqType.TypeID, ctag);
                        }
                    };

                    return true;
                }
                catch (e) {
                    // TODO: logger?
                    return false;
                }
            })();
        }
        catch (e) {
            console.log('[ERROR] - Connection problem %s', e);
        }
    }

    // ========== Publish / Subscribe ==========
    public Publish(msg: MsgType, withTopic:string = ""): Promise<boolean> {
        return this.pubMgr.publish(msg, withTopic);
    }

    public async Subscribe(type: MsgType, subscriberName: string, handler: MsgHandlerExt, withTopic: string = '#'): Promise<IConsumer>
    {
        const queueID = `${_.defaultTo(type.TypeID, "")}_${subscriberName}`;
        if (queueID.length === subscriberName.length + 1) {
            return Promise.reject(`${type.TypeID} is not a valid TypeID`);
        }

        const channel = await this.Connection.createChannel();

        await channel.prefetch(this.config.prefetch);
        await channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false });
        await channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false });
        await channel.bindQueue(queueID, type.TypeID, withTopic);

        const ctag = await channel.consume(queueID, (msg: amqp.ConsumeMessage | null) => {
            // TODO - why would this equal null?
            if (msg !== null) {
                const _msg = this.subMgr.hydratePayload(msg.content)!; // TODO - NO GOOD!!!!

                if (msg.properties.type === type.TypeID) {
                    _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events - is this still valid?

                    let ackdOrNackd = false;
                    let deferred = false;
                    let deferTimeout: NodeJS.Timeout;

                    const ack = () => {
                        if (deferred) clearTimeout(deferTimeout);
                        channel.ack(msg);
                        ackdOrNackd = true;
                    };

                    const nack = () => {
                        if (deferred) clearTimeout(deferTimeout);
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
                            if (_.isNumber(guard)) {
                                if (!_.isSafeInteger(guard)) {
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

                    if (!ackdOrNackd && !deferred) channel.ack(msg);
                }
                else {
                    this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} != ${type.TypeID}`);
                }
            }
        });

        return {
            cancelConsumer: async () => {
                try {
                    await channel.cancel(ctag.consumerTag);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            deleteQueue: async () => {
                try {
                    await channel.deleteQueue(queueID);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            purgeQueue: async () => {
                try {
                    await channel.purgeQueue(queueID);
                    return true;
                }
                catch (e) {
                    return false;
                }
            }
        };
    }

    // ========== Send / Receive ==========
    public Send(queue: string, msg: MsgType): Promise<boolean> {
        return this.pubMgr.sendToQueue(queue, msg);
    }

    public async Receive(rxType: MsgType, queue: string, handler: MsgHandlerExt): Promise<IConsumer>
    {
        const channel = await this.Connection.createChannel();

        await channel.prefetch(this.config.prefetch);
        await channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });

        const ctag = await channel.consume(queue, msg => {
            // TODO - why would this equal null?
            if (msg !== null) {
                const _msg = this.subMgr.hydratePayload(msg.content)!; // TODO - NO GOOD!!!!

                if (msg.properties.type === rxType.TypeID) {
                    _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events - is this still valid?

                    let ackdOrNackd = false;
                    let deferred = false;
                    let deferTimeout: NodeJS.Timeout;

                    const ack = () => {
                        if (deferred) clearTimeout(deferTimeout);
                        channel.ack(msg);
                        ackdOrNackd = true;
                    };

                    const nack = () => {
                        if (deferred) clearTimeout(deferTimeout);
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
                            if (_.isNumber(guard)) {
                                if (!_.isSafeInteger(guard)) {
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

                    if (!ackdOrNackd && !deferred) channel.ack(msg);
                }
                else {
                    this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} != ${rxType.TypeID}`);
                }
            }
        });

        return {
            cancelConsumer: async () => {
                try {
                    await channel.cancel(ctag.consumerTag);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            deleteQueue: async () => {
                try {
                    await channel.deleteQueue(queue);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            purgeQueue: async () => {
                try {
                    await channel.purgeQueue(queue);
                    return true;
                }
                catch (e) {
                    return false;
                }
            }
        };
    }

    public async ReceiveTypes(queue: string, handlerDefinitions: { rxType: MsgType; handler: MsgHandlerExt }[]): Promise<IConsumer>
    {
        const channel = await this.Connection.createChannel();

        await channel.prefetch(this.config.prefetch);
        await channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });

        const ctag = await channel.consume(queue, msg => {
            // TODO - why would this equal null?
            if (msg !== null) {
                const _msg = this.subMgr.hydratePayload(msg.content)!; // TODO - NO GOOD!!!!

                let msgHandled = false;

                handlerDefinitions
                    .filter(hdlrDef => hdlrDef.rxType.TypeID === msg.properties.type)
                    .map(hdlrDef => hdlrDef.handler)
                    .forEach(handler => {
                        msgHandled = true;

                        _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events - is this still valid?

                        let ackdOrNackd = false;
                        let deferred = false;
                        let deferTimeout: NodeJS.Timeout;

                        const ack = () => {
                            if (deferred) clearTimeout(deferTimeout);
                            channel.ack(msg);
                            ackdOrNackd = true;
                        };

                        const nack = () => {
                            if (deferred) clearTimeout(deferTimeout);
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
                                if (_.isNumber(guard)) {
                                    if (!_.isSafeInteger(guard)) {
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

                        if (!ackdOrNackd && !deferred) channel.ack(msg);
                    });

                if (!msgHandled) {
                    this.SendToErrorQueue(_msg, `message with unhandled TypeID: ${msg.properties.type}`);
                }
            }
        });

        return {
            cancelConsumer: async () => {
                try {
                    await channel.cancel(ctag.consumerTag);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            deleteQueue: async () => {
                try {
                    await channel.deleteQueue(queue);
                    return true;
                }
                catch (e) {
                    return false;
                }
            },
            purgeQueue: async () => {
                try {
                    await channel.purgeQueue(queue);
                    return true;
                }
                catch (e) {
                    return false;
                }
            }
        };
    }


    // ========== Request / Response ==========
    public Request<T extends MsgType>(request: MsgType): Promise<T> {
        return this.rpcMgr.request<T>(request);
    }

    // should this have a name for competing consumer?
    public async Respond(rqType: MsgType, rsType: MsgType, handler: SyncMsgFunctionExt): Promise<IConsumer> {
        // TODO - a bit much, Michael vvv..... isMsgType
        const rejectedTypes =
            [rqType, rsType]
            .filter(t => !(_.isString(t.TypeID) && t.TypeID.length > 0))
            .map((_, idx) => `${idx === 0 ? "request" : "respond"} TypeID is invalid`)
            .join(", ");

        if (rejectedTypes.length > 0) {
            return Promise.reject(rejectedTypes);
        }

        return this.rpcMgr.respond(rqType, rsType, handler as MsgFunctionExt);
    }

    public async RespondAsync(rqType: MsgType, rsType: MsgType, handler: AsyncMsgFunctionExt): Promise<IConsumer> {
        // TODO - a bit much, Michael vvv..... isMsgType
        const rejectedTypes =
            [rqType, rsType]
                .filter(t => !(_.isString(t.TypeID) && t.TypeID.length > 0))
                .map((_, idx) => `${idx === 0 ? "request" : "respond"} TypeID is invalid`)
                .join(", ");

        if (rejectedTypes.length > 0) {
            return Promise.reject(rejectedTypes);
        }

        return this.rpcMgr.respond(rqType, rsType, handler as MsgFunctionExt);
    }


    public SendToErrorQueue(msg: MsgType): Promise<boolean>;
    public SendToErrorQueue(msg: MsgType, err: string | Error): Promise<boolean>;
    public SendToErrorQueue(msg: MsgType, err: string, stack: string): Promise<boolean>;
    public SendToErrorQueue(msg: MsgType, err: string | Error = "", stack: string = ""): Promise<boolean> {
        const errQueueMsg = _.isError(err) ? new ErrorQueueMessage(msg, err) : new ErrorQueueMessage(msg, err, stack);
        return this.Send(Bus.defaultErrorQueue, errQueueMsg);
    }
}

export class ExtendedBus extends Bus implements IExtendedBus {

    constructor(config: IBusConfig) {
        super(config);
    }

    public async CancelConsumer(consumerTag: string): Promise<boolean> {
        try {
            await this.PublishChannel.cancel(consumerTag);
            return true;
        }
        catch (e) {
            return false;
        }
    }

    public async DeleteExchange(exchange: string, ifUnused: boolean = false): Promise<boolean> {
        try {
            this.PublishChannel.deleteExchange(exchange, { ifUnused: ifUnused });
            return true;
        }
        catch (e) {
            return false;
        }
    }

    public async DeleteQueue(queue: string, ifUnused: boolean = false, ifEmpty: boolean = false): Promise<amqp.Replies.DeleteQueue> {
        try {
            return await this.PublishChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty });
        }
        catch (e) {
            let error = `Failed deleting queue ${ queue }`;

            if (_.isError(e)) {
                error = `${error} - ${e.name}: ${e.message}`;
            }

            return Promise.reject(error);
        }
    }

    public DeleteQueueUnconditional(queue: string): Promise<amqp.Replies.DeleteQueue> {
        return this.DeleteQueue(queue, false, false);
    }

    public async QueueStatus(queue: string): Promise<amqp.Replies.AssertQueue> {
        try {
            return await this.PublishChannel.checkQueue(queue);
        }
        catch (e) {
            let error = `Failed retrieving status for ${queue}`;

            if (_.isError(e)) {
                error = `${error} - ${e.name}: ${e.message}`;
            }

            return Promise.reject(error);
        }
    }

    public async PurgeQueue(queue: string): Promise<amqp.Replies.PurgeQueue> {
        try {
            return await this.PublishChannel.purgeQueue(queue);
        }
        catch (e) {
            let error = `Failed purging queue ${queue}`;

            if (_.isError(e)) {
                error = `${error} - ${e.name}: ${e.message}`;
            }

            return Promise.reject(error);
        }
    }
}


export interface IBusConfig {
    heartbeat: number;
    prefetch: number;
    rpcTimeout: number;
    url: string;
    vhost: string;
}

export interface IBus {
    Publish(msg: MsgType, withTopic?: string): Promise<boolean>;
    Subscribe(type: MsgType, subscriberName: string, handler: (msg: MsgType, ackFns?: { ack: () => void; nack: () => void }) => void, withTopic?: string): Promise<IConsumer>;

    Send(queue: string, msg: MsgType): Promise<boolean>;
    Receive(rxType: MsgType, queue: string, handler: (msg: MsgType, ackFns?: { ack: () => void; nack: () => void }) => void): Promise<IConsumer>;
    ReceiveTypes(queue: string, handlers: { rxType: MsgType; handler: (msg: MsgType, ackFns?: { ack: () => void; nack: () => void }) => void }[]): Promise<IConsumer>;

    Request(request: MsgType): Promise<MsgType>;
    Respond(rqType: MsgType, rsType: MsgType, responder: (msg: MsgType, ackFns?: { ack: () => void; nack: () => void }) => MsgType): Promise<IConsumer>
    RespondAsync(rqType: MsgType, rsType: MsgType, responder: (msg: MsgType, ackFns?: { ack: () => void; nack: () => void }) => Promise<MsgType>): Promise<IConsumer>

    SendToErrorQueue(msg: MsgType, err?: string, stack?: string): void;
}

export interface IExtendedBus extends IBus {
    CancelConsumer(consumerTag: string): Promise<boolean>;
    DeleteExchange(exchange: string, ifUnused: boolean): Promise<boolean>;
    DeleteQueue(queue: string, ifUnused: boolean, ifEmpty: boolean): Promise<amqp.Replies.DeleteQueue>;
    DeleteQueueUnconditional(queue: string): Promise<amqp.Replies.DeleteQueue>;
    QueueStatus(queue: string): Promise<amqp.Replies.AssertQueue>;
    PurgeQueue(queue: string): Promise<amqp.Replies.PurgeQueue>;
}

export interface IConsumer {
    cancelConsumer: () => Promise<boolean>;
    deleteQueue: () => Promise<boolean>;
    purgeQueue: () => Promise<boolean>;
}

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
