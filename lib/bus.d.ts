import amqp from "amqplib";
interface MsgType {
    TypeID: string;
}
interface AckExts {
    ack(): void;
    nack(): void;
    defer(action: (..._: any[]) => Promise<boolean>): void;
}
declare type MsgHandlerExt = (msg: MsgType, ackFns: AckExts) => void;
export declare class RabbitHutch {
    static CreateBus(config: IBusConfig): IBus;
    static CreateExtendedBus(config: IBusConfig): IExtendedBus;
}
declare class Bus implements IBus {
    config: IBusConfig;
    private static rpcExchange;
    private static rpcQueueBase;
    private static defaultErrorQueue;
    private static defaultDeferredAckTimeout;
    Ready: PromiseLike<boolean>;
    private Connection;
    private rpcQueue;
    private rpcResponseHandlers;
    protected Channels: {
        publishChannel: amqp.ConfirmChannel;
        rpcChannel: amqp.Channel;
    };
    private pubMgr;
    private subMgr;
    constructor(config: IBusConfig);
    Publish(msg: MsgType, withTopic?: string): Promise<boolean>;
    Subscribe(type: MsgType, subscriberName: string, handler: MsgHandlerExt, withTopic?: string): Promise<IConsumerDispose>;
    Send(queue: string, msg: MsgType): Promise<boolean>;
    Receive(rxType: MsgType, queue: string, handler: MsgHandlerExt): Promise<IConsumerDispose>;
    ReceiveTypes(queue: string, handlers: {
        rxType: {
            TypeID: string;
        };
        handler: (msg: {
            TypeID: string;
        }, ackFns?: {
            ack: () => void;
            nack: () => void;
            defer: () => void;
        }) => void;
    }[]): Promise<IConsumerDispose>;
    Request(request: {
        TypeID: string;
    }): Promise<any>;
    Respond(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => {
        TypeID: string;
    }): Promise<IConsumerDispose>;
    RespondAsync(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => Promise<{
        TypeID: string;
    }>): Promise<IConsumerDispose>;
    SendToErrorQueue(msg: any, err?: string, stack?: string): any;
}
export declare class ExtendedBus extends Bus implements IExtendedBus {
    constructor(config: IBusConfig);
    CancelConsumer(consumerTag: string): Promise<IQueueConsumeReply>;
    DeleteExchange(exchange: string, ifUnused?: boolean): void;
    DeleteQueue(queue: string, ifUnused?: boolean, ifEmpty?: boolean): Promise<{
        messageCount: number;
    }>;
    DeleteQueueUnconditional(queue: string): Promise<{
        messageCount: number;
    }>;
    QueueStatus(queue: string): Promise<{
        queue: string;
        messageCount: number;
        consumerCount: number;
    }>;
    PurgeQueue(queue: string): Promise<IPurgeQueueResponse>;
}
export interface IBus {
    Publish(msg: {
        TypeID: string;
    }, withTopic?: string): Promise<boolean>;
    Subscribe(type: {
        TypeID: string;
    }, subscriberName: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void, withTopic?: string): Promise<IConsumerDispose>;
    Send(queue: string, msg: {
        TypeID: string;
    }): Promise<boolean>;
    Receive(rxType: {
        TypeID: string;
    }, queue: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void): Promise<IConsumerDispose>;
    ReceiveTypes(queue: string, handlers: {
        rxType: {
            TypeID: string;
        };
        handler: (msg: {
            TypeID: string;
        }, ackFns?: {
            ack: () => void;
            nack: () => void;
        }) => void;
    }[]): Promise<IConsumerDispose>;
    Request(request: {
        TypeID: string;
    }): Promise<{
        TypeID: string;
    }>;
    Respond(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => {
        TypeID: string;
    }): Promise<IConsumerDispose>;
    RespondAsync(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => Promise<{
        TypeID: string;
    }>): Promise<IConsumerDispose>;
    SendToErrorQueue(msg: any, err?: string, stack?: string): void;
}
export interface IBusConfig {
    heartbeat: number;
    prefetch: number;
    rpcTimeout: number;
    url: string;
    vhost: string;
}
export interface IExtendedBus extends IBus {
    CancelConsumer(consumerTag: string): Promise<IQueueConsumeReply>;
    DeleteExchange(exchange: string, ifUnused: boolean): void;
    DeleteQueue(queue: string, ifUnused: boolean, ifEmpty: boolean): Promise<{
        messageCount: number;
    }>;
    DeleteQueueUnconditional(queue: string): Promise<{
        messageCount: number;
    }>;
    QueueStatus(queue: string): Promise<{
        queue: string;
        messageCount: number;
        consumerCount: number;
    }>;
    PurgeQueue(queue: string): Promise<IPurgeQueueResponse>;
}
export interface IQueueConsumeReply {
    consumerTag: string;
}
export interface IConsumerDispose {
    cancelConsumer: () => Promise<boolean>;
    deleteQueue: () => Promise<boolean>;
    purgeQueue: () => Promise<boolean>;
}
export interface IPurgeQueueResponse {
    messageCount: number;
}
export {};
