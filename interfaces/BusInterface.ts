var uuid = require('node-uuid');

export interface IBus {
    Start: Promise<{ success: boolean; reason?: string }>;
    RunBusTest(log: boolean): Promise<boolean>;

    Publish(msg: ifBusCS.IPublishable): Promise<boolean>;
    Subscribe(subscriberName: string, type: string, handler: (msg: ifBusCS.IPublishable) => void): Promise<IQueueConsumeReply>;

    Send(queue: string, msg: ifBusCS.IPublishable): Promise<boolean>;
    Receive(queue: string, handler: (msg: ifBusCS.IPublishable) => void): Promise<IQueueConsumeReply>;
    ReceiveTypes(queue: string, handlers: { type: string; handler: (msg: ifBusCS.IPublishable) => void }[]): Promise<IQueueConsumeReply>;

    Request<Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(request: Rq): { ackd: Promise<boolean>; response: Promise<Rs> };
    Respond<Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(rqType: string, rsType: string, responder: (msg: Rq) => Promise<Rs>): Promise<IQueueConsumeReply>
}

export interface IBusConfig {
    heartbeat: number;
    prefetch: number;
    runTest: boolean;
    stopOnTestFail: boolean;
    url: string;
    vhost: string;
}

export interface IExtendedBus extends IBus {
    CancelConsumer(consumerTag: string): Promise<{ consumerTag: string }>;
    DeleteExchange(exchange: string, ifUnused: boolean): void;
    DeleteQueue(queue: string, ifUnused: boolean, ifEmpty: boolean): Promise<{ messageCount: number }>
    QueueStatus(queue: string): Promise<{ queue: string; messageCount: number; consumerCount: number; }>;
}

export interface IPublishedObj {
    content: NodeBuffer;
    fields: any;
    properties: any;
}

export interface IQueueConsumeReply {
    consumerTag: string;
}

export class TestMessage implements ifBusCS.IPublishable {
    public static TypeID = 'Bus.TestMessage:Bus';
    public TypeID = 'Bus.TestMessage:Bus';

    public ID: string = null;

    constructor(public Text: string) {
        this.ID = uuid.v4();
    }
}

export class TestMessageResponse implements ifBusCS.IPublishable {
    public static TypeID = 'Bus.TestMessageResponse:Bus';
    public TypeID = 'Bus.TestMessageResponse:Bus';

    public ID: string = null;

    constructor(public Text: string, public SentText: string) {
        this.ID = uuid.v4();
    }
}