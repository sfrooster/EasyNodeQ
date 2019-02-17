import amqp from "amqplib";
interface MsgType {
    TypeID: string;
}
declare type deferGuardType = number | (() => Promise<boolean>);
interface AckExts {
    ack(): void;
    nack(): void;
    defer(guard: deferGuardType): void;
}
declare type AsyncMsgFunctionExt = <T extends Promise<MsgType>>(msg: MsgType, ackFns: AckExts) => T;
declare type SyncMsgFunctionExt = <T extends MsgType>(msg: MsgType, ackFns: AckExts) => T;
declare type MsgHandlerExt = (msg: MsgType, ackFns: AckExts) => void;
export declare class RabbitHutch {
    static CreateBus(config: IBusConfig): Promise<IBus>;
    static CreateExtendedBus(config: IBusConfig): Promise<IExtendedBus>;
}
declare class Bus implements IBus {
    config: IBusConfig;
    private static defaultErrorQueue;
    private static defaultDeferredAckTimeout;
    private Connection;
    private pubMgr;
    private subMgr;
    private rpcMgr;
    protected readonly PublishChannel: amqp.Channel;
    readonly Ready: PromiseLike<boolean>;
    constructor(config: IBusConfig);
    Publish(msg: MsgType, withTopic?: string): Promise<boolean>;
    Subscribe(type: MsgType, subscriberName: string, handler: MsgHandlerExt, withTopic?: string): Promise<IConsumer>;
    Send(queue: string, msg: MsgType): Promise<boolean>;
    Receive(rxType: MsgType, queue: string, handler: MsgHandlerExt): Promise<IConsumer>;
    ReceiveTypes(queue: string, handlerDefinitions: {
        rxType: MsgType;
        handler: MsgHandlerExt;
    }[]): Promise<IConsumer>;
    Request<T extends MsgType>(request: MsgType): Promise<T>;
    Respond(rqType: MsgType, rsType: MsgType, handler: SyncMsgFunctionExt): Promise<IConsumer>;
    RespondAsync(rqType: MsgType, rsType: MsgType, handler: AsyncMsgFunctionExt): Promise<IConsumer>;
    SendToErrorQueue(msg: MsgType): Promise<boolean>;
    SendToErrorQueue(msg: MsgType, err: string | Error): Promise<boolean>;
    SendToErrorQueue(msg: MsgType, err: string, stack: string): Promise<boolean>;
}
export declare class ExtendedBus extends Bus implements IExtendedBus {
    constructor(config: IBusConfig);
    CancelConsumer(consumerTag: string): Promise<boolean>;
    DeleteExchange(exchange: string, ifUnused?: boolean): Promise<boolean>;
    DeleteQueue(queue: string, ifUnused?: boolean, ifEmpty?: boolean): Promise<amqp.Replies.DeleteQueue>;
    DeleteQueueUnconditional(queue: string): Promise<amqp.Replies.DeleteQueue>;
    QueueStatus(queue: string): Promise<amqp.Replies.AssertQueue>;
    PurgeQueue(queue: string): Promise<amqp.Replies.PurgeQueue>;
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
    Subscribe(type: MsgType, subscriberName: string, handler: (msg: MsgType, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void, withTopic?: string): Promise<IConsumer>;
    Send(queue: string, msg: MsgType): Promise<boolean>;
    Receive(rxType: MsgType, queue: string, handler: (msg: MsgType, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void): Promise<IConsumer>;
    ReceiveTypes(queue: string, handlers: {
        rxType: MsgType;
        handler: (msg: MsgType, ackFns?: {
            ack: () => void;
            nack: () => void;
        }) => void;
    }[]): Promise<IConsumer>;
    Request(request: MsgType): Promise<MsgType>;
    Respond(rqType: MsgType, rsType: MsgType, responder: (msg: MsgType, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => MsgType): Promise<IConsumer>;
    RespondAsync(rqType: MsgType, rsType: MsgType, responder: (msg: MsgType, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => Promise<MsgType>): Promise<IConsumer>;
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
export {};
