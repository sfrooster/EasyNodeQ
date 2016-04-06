/// <reference path="typings/main.d.ts" />
import Promise = require('bluebird');
export declare class RabbitHutch {
    static CreateBus(config: IBusConfig): IBus;
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
    SendToErrorQueue(msg: any, err?: string, stack?: string): Promise<boolean>;
    constructor(config: IBusConfig);
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
    static ToBuffer(obj: any): NodeBuffer;
    static FromSubscription(obj: IPublishedObj): any;
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
}
export interface IPublishedObj {
    content: NodeBuffer;
    fields: any;
    properties: any;
}
export interface IQueueConsumeReply {
    consumerTag: string;
}
export interface IConsumerDispose {
    cancelConsumer: () => Promise<boolean>;
    deleteQueue: () => Promise<boolean>;
}
