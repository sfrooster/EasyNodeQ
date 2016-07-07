import * as bbPromise from 'bluebird';
export declare class RabbitHutch {
    static CreateBus(config: IBusConfig): IExtendedBus;
}
export declare class Bus implements IExtendedBus {
    config: IBusConfig;
    private static rpcExchange;
    private static rpcQueueBase;
    private static defaultErrorQueue;
    private Connection;
    private rpcQueue;
    private rpcConsumerTag;
    private rpcResponseHandlers;
    private Channels;
    private pubChanUp;
    private rpcConsumerUp;
    private static remove$type;
    SendToErrorQueue(msg: any, err?: string, stack?: string): bbPromise<boolean>;
    constructor(config: IBusConfig);
    Publish(msg: {
        TypeID: string;
    }, withTopic?: string): bbPromise<boolean>;
    Subscribe(type: {
        TypeID: string;
    }, subscriberName: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void, withTopic?: string): bbPromise<IConsumerDispose>;
    Send(queue: string, msg: {
        TypeID: string;
    }): bbPromise<boolean>;
    Receive(rxType: {
        TypeID: string;
    }, queue: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void): bbPromise<IConsumerDispose>;
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
    }[]): bbPromise<IConsumerDispose>;
    Request(request: {
        TypeID: string;
    }): bbPromise<any>;
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
    }): bbPromise<IConsumerDispose>;
    RespondAsync(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => bbPromise<{
        TypeID: string;
    }>): bbPromise<IConsumerDispose>;
    private static ToBuffer(obj);
    private static FromSubscription(obj);
    CancelConsumer(consumerTag: string): bbPromise<IQueueConsumeReply>;
    DeleteExchange(exchange: string, ifUnused?: boolean): void;
    DeleteQueue(queue: string, ifUnused?: boolean, ifEmpty?: boolean): bbPromise<{
        messageCount: number;
    }>;
    DeleteQueueUnconditional(queue: string): bbPromise<{
        messageCount: number;
    }>;
    QueueStatus(queue: string): bbPromise<{
        queue: string;
        messageCount: number;
        consumerCount: number;
    }>;
}
export interface IBus {
    Publish(msg: {
        TypeID: string;
    }, withTopic?: string): bbPromise<boolean>;
    Subscribe(type: {
        TypeID: string;
    }, subscriberName: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void, withTopic?: string): bbPromise<IConsumerDispose>;
    Send(queue: string, msg: {
        TypeID: string;
    }): bbPromise<boolean>;
    Receive(rxType: {
        TypeID: string;
    }, queue: string, handler: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => void): bbPromise<IConsumerDispose>;
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
    }[]): bbPromise<IConsumerDispose>;
    Request(request: {
        TypeID: string;
    }): bbPromise<{
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
    }): bbPromise<IConsumerDispose>;
    RespondAsync(rqType: {
        TypeID: string;
    }, rsType: {
        TypeID: string;
    }, responder: (msg: {
        TypeID: string;
    }, ackFns?: {
        ack: () => void;
        nack: () => void;
    }) => bbPromise<{
        TypeID: string;
    }>): bbPromise<IConsumerDispose>;
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
    CancelConsumer(consumerTag: string): bbPromise<IQueueConsumeReply>;
    DeleteExchange(exchange: string, ifUnused: boolean): void;
    DeleteQueue(queue: string, ifUnused: boolean, ifEmpty: boolean): bbPromise<{
        messageCount: number;
    }>;
    DeleteQueueUnconditional(queue: string): bbPromise<{
        messageCount: number;
    }>;
    QueueStatus(queue: string): bbPromise<IQueueStats>;
}
export interface IQueueConsumeReply {
    consumerTag: string;
}
export interface IConsumerDispose {
    cancelConsumer: () => bbPromise<boolean>;
    deleteQueue: () => bbPromise<boolean>;
}
export interface IQueueStats {
    queue: string;
    messageCount: number;
    consumerCount: number;
}
