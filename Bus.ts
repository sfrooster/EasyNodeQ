
var ampq = require('amqplib');
import ifBus = require('./interfaces/BusInterface');
import Promise = require('bluebird');
var uuid = require('node-uuid');

export class Bus implements ifBus.IBus {

    private ConfirmChannel: any = null;
    private Connection: any = null;
    private static rpcQueueBase = 'easynetq.response.';
    private static rpcExchange = 'easy_net_q_rpc';

    public Start: Promise<{ success: boolean; reason?: string }>;
    private ReStart: () => void;

    constructor(config: ifBus.IBusConfig) {
        var handleChannelErrorBound = this.handleChannelError.bind(this);
        var handleChannelCloseBound = this.handleChannelClose.bind(this);

        this.Start = Promise.resolve(ampq.connect(config.url + (config.vhost !== null ? '/' + config.vhost : '') + '?heartbeat=' + config.heartbeat))
            .then((connection) => {
                this.Connection = connection;
                return Promise.resolve(connection.createConfirmChannel());
            })
            .then((channel) => {
                this.ConfirmChannel = channel;
                channel.on('error', handleChannelErrorBound);
                channel.on('close', handleChannelCloseBound);
                channel.prefetch(config.prefetch);
                return { success: true };
            })
            .catch((failReason) => {
                return { success: false, reason: failReason };
            });

        //this.ReStart = () => {
        //    this.Started = Promise.cast<{ success: boolean }>({ success: false, reason: 'restarting' });
        //    this.ConfirmChannel.close();
        //    this.Started = Promise.resolve(ampq.connect(url, { heartbeat: heartbeat }))
        //        .then((connection) => {
        //            this.Connection = connection;
        //            return Promise.resolve(connection.createConfirmChannel());
        //        })
        //        .then((channel) => {
        //            this.ConfirmChannel = channel;
        //            channel.on('error', handleChannelErrorBound);
        //            channel.on('close', handleChannelCloseBound);
        //            channel.prefetch(prefetch);
        //            return { success: true };
        //        })
        //        .catch((failReason) => {
        //            return { success: false, reason: failReason };
        //        });
        //}
    }

    // ========== Etc  ==========
    public static ToBuffer(obj: any): NodeBuffer {
        return new Buffer(JSON.stringify(obj));
    }

    public static FromBuffer(buffer: NodeBuffer): any {
        return JSON.parse(buffer.toString())
    }

    public static FromSubscription(obj: ifBus.IPublishedObj): any {
        return JSON.parse(obj.content.toString())
    }

    private handleChannelClose() {
        console.log('[LOG] - Channel close called...');
        //TODO do something here?
    }

    private handleChannelError(error: any) {
        console.error('[ERROR]' + error);
        //TODO: what else on channel error? shutdown....?

        //restart channel? below doesn't work yet...
        //console.info('Attempting bus/channel restart...');
        //this.ReStart();
        //this.Started
        //    .then((started) => {
        //        if (started.success) {
        //            console.info('Restarted');
        //        }
        //        else {
        //            console.error('Failed restarting bus/channel: %s', started.reason);
        //        }
        //    });
    }

    private handleAck(): boolean {
        return true;
    }

    private handleNack(err): boolean {
        return false;
    }

    public RunBusTest(log:boolean = true): Promise<boolean> {
        return this.Start.then((started) => {
            if (started.success) {
                var testResult = this.TestBus();

                if (log) {
                    testResult.Publish.then((success) => console.log('[TEST] - PUBLISH: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Subscribe.then((success) => console.log('[TEST] - SUBSCRIBE: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Send.then((success) => console.log('[TEST] - SEND: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Receive.then((success) => console.log('[TEST] - RECEIVE: %s', success ? 'PASS' : 'FAIL'));
                    testResult.ReceiveTypes.then((success) => console.log('[TEST] - RECEIVE TYPES: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Request.then((success) => console.log('[TEST] - REQUEST: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Response.then((success) => console.log('[TEST] - RESPONSE: %s', success ? 'PASS' : 'FAIL'));
                    testResult.Aggregate.then((success) => console.log('[TEST] - OVERALL: %s', success?'PASS':'FAIL'));
                }

                return testResult.Aggregate;
            }
            else {
            }
        });
    }

    public TestBus(): { Aggregate: Promise<boolean>; Publish: Promise<boolean>; Subscribe: Promise<boolean>; Send: Promise<boolean>; Receive: Promise<boolean>; ReceiveTypes: Promise<boolean>; Request: Promise<boolean>; Response: Promise<boolean>; } {

        var aggregateDeferred = Promise.defer<boolean>();
        var publishDeferred = Promise.defer<boolean>();
        var subscribeDeferred = Promise.defer<boolean>();
        var sendDeferred = Promise.defer<boolean>();
        var receiveDeferred = Promise.defer<boolean>();
        var receiveTypeDeferred = Promise.defer<boolean>();
        var requestDeferred = Promise.defer<boolean>();
        var responseDeferred = Promise.defer<boolean>();
        var requestRespondTest_CTag = null;
        var pubSubTest_CTag = null;
        var sendReceiveTest_CTag = null;
        var sendReceiveTypedTest_CTag = null;

        var testSubId = 'test-' + uuid.v4();
        var testQueue = 'testQueue-' + uuid.v4();
        var testQueueTyped = testQueue + '-Typed';

        this.Start.then((started) => {
            if (started.success) {
                this.Respond<ifBus.TestMessage, ifBus.TestMessageResponse>(ifBus.TestMessage.TypeID, ifBus.TestMessageResponse.TypeID,
                    (msg) => {
                        requestDeferred.resolve(true);
                        var resp = new ifBus.TestMessageResponse('my response', msg.Text);
                        return Promise.cast(resp);
                    })
                    .then((ctag) => {
                        requestRespondTest_CTag = ctag.consumerTag;
                        this.Request<ifBus.TestMessage, ifBus.TestMessageResponse>(new ifBus.TestMessage('my request'));
                    })
                    .then((apcr) => {
                        responseDeferred.resolve(true);
                    })
                    .done();

                this.Subscribe(testSubId, ifBus.TestMessage.TypeID,
                    (msg) => {
                        publishDeferred.resolve(true);
                        subscribeDeferred.resolve(true);
                    })
                    .then((ctag) => {
                        pubSubTest_CTag = ctag.consumerTag;
                        this.Publish(new ifBus.TestMessage('publish'))
                    })
                    .done();

                this.Receive(testQueue,
                    (msg) => {
                        sendDeferred.resolve(true);
                        receiveDeferred.resolve(true);
                    })
                    .then((ctag) => {
                        sendReceiveTest_CTag = ctag.consumerTag;
                        this.Send(testQueue, new ifBus.TestMessage('send'))
                    })
                    .done();

                this.ReceiveTypes(testQueueTyped, [{
                    type: ifBus.TestMessage.TypeID, handler:
                    (msg) => {
                        receiveTypeDeferred.resolve(true);
                    }
                }])
                    .then((ctag) => {
                        sendReceiveTypedTest_CTag = ctag.consumerTag;
                        this.Send(testQueueTyped, new ifBus.TestMessage('send'))
                    })
                    .catch((failreason) => {
                        receiveTypeDeferred.reject(failreason);
                    })
                    .done();
            }
        });

        Promise.all([publishDeferred.promise, subscribeDeferred.promise, sendDeferred.promise, receiveDeferred.promise, receiveTypeDeferred.promise, requestDeferred.promise, responseDeferred.promise])
            .then((vals) => {
                this.CancelConsumer(requestRespondTest_CTag)
                    .then((cancelReply) => this.DeleteQueue(ifBus.TestMessage.TypeID, true, true))
                    .then((deleteReply) => this.DeleteExchange(ifBus.TestMessage.TypeID, true));

                this.CancelConsumer(pubSubTest_CTag).then((cancelReply) => {
                    this.DeleteQueue(ifBus.TestMessage.TypeID + '_' + testSubId, true, true);
                });

                this.CancelConsumer(sendReceiveTest_CTag).then((cancelReply) => {
                    this.DeleteQueue(testQueue, true, true);
                });

                this.CancelConsumer(sendReceiveTypedTest_CTag).then((cancelReply) => {
                    this.DeleteQueue(testQueueTyped, true, true);
                });

                aggregateDeferred.resolve(vals.every((val) => val));
            });

        return { Aggregate: aggregateDeferred.promise, Publish: publishDeferred.promise, Subscribe: subscribeDeferred.promise, Send: sendDeferred.promise, Receive: receiveDeferred.promise, ReceiveTypes: receiveTypeDeferred.promise, Request: requestDeferred.promise, Response: responseDeferred.promise };
    }

    // ========== Publish / Subscribe ==========
    public Publish(obj: ifBusCS.IPublishable): Promise<boolean> {
        //TODO use everywhere - make "global"
        var confirmPublish = Promise.promisify(this.ConfirmChannel.publish, this.ConfirmChannel);

        return Promise.resolve(this.ConfirmChannel.assertExchange(obj.TypeID, 'topic', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => confirmPublish(obj.TypeID, '', Bus.ToBuffer(obj), { type: obj.TypeID }))
            .then(this.handleAck, this.handleNack)
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error publishing: %s', failReason);
                return false;
            });
    }

    public Subscribe(subscriberName: string, type: string, handler: (msg: ifBusCS.IPublishable) => void): Promise<{ consumerTag: string }> {
        var queueId = type + '_' + subscriberName;

        return Promise.resolve(this.ConfirmChannel.assertQueue(queueId, { durable: true, exclusive: false, autoDelete: false }))
            .then((okQueueReply) => Promise.resolve(this.ConfirmChannel.assertExchange(type, 'topic', { durable: true, autoDelete: false })))
            .then((okExchangeReply) => Promise.resolve(this.ConfirmChannel.bindQueue(queueId, type, '')))
            .then((okBindReply) =>
                this.ConfirmChannel.consume(queueId,
                    (msg: ifBus.IPublishedObj) => {
                        //ack first
                        this.ConfirmChannel.ack(msg);
                        handler(Bus.FromSubscription(msg));
                    })
            )
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error creating consumer: %s', failReason);
                return null;
            });
    }

    // ========== Send / Receive ==========
    public Send(queue: string, msg: ifBusCS.IPublishable): Promise<boolean> {
        var confirmSendToQueue = Promise.promisify(this.ConfirmChannel.sendToQueue, this.ConfirmChannel);

        return confirmSendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID })
            .then(this.handleAck, this.handleNack)
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error publishing: %s', failReason);
                return false;
            });
    }

    public Receive(queue: string, handler: (msg: ifBusCS.IPublishable) => void): Promise<{ consumerTag: string }> {
        return Promise.resolve(this.ConfirmChannel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false }))
            .then((okQueueReply) =>
                this.ConfirmChannel.consume(queue, (msg) => {
                    //ack first
                    this.ConfirmChannel.ack(msg);
                    var unWrapMsg: ifBusCS.IPublishable = Bus.FromSubscription(msg)
                    handler(unWrapMsg);
                })
            )
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error creating consumer: %s', failReason);
                return null;
            });
    }

    public ReceiveTypes(queue: string, handlers: { type: string; handler: (msg: ifBusCS.IPublishable) => void }[]): Promise<{ consumerTag: string }> {
        return Promise.resolve(this.ConfirmChannel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false }))
            .then((okQueueReply) =>
                this.ConfirmChannel.consume(queue, (msg: ifBus.IPublishedObj) => {
                    //ack first
                    this.ConfirmChannel.ack(msg);
                    var unWrapMsg: ifBusCS.IPublishable = Bus.FromSubscription(msg)
                    handlers.filter((handler) => handler.type === msg.properties.type).forEach((handler) => {
                        handler.handler(unWrapMsg);
                    });
                })
            )
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error creating consumer: %s', failReason);
                return null;
            });
    }

    // ========== Request / Response ==========
    public Request<Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(request: Rq): { ackd: Promise<boolean>; response: Promise<Rs> } {
        var ackdPromise: Promise<boolean>;
        var responsePromise: Promise<Rs>;

        var confirmPublish = Promise.promisify(this.ConfirmChannel.publish, this.ConfirmChannel);

        var consumerTag = uuid.v4();
        var responseQueue = Bus.rpcQueueBase + consumerTag;

        var responseDeferred = Promise.defer<Rs>();
        var handleResponse = (msg: ifBus.IPublishedObj): void => {
            //ack first
            this.ConfirmChannel.ack(msg);
            this.ConfirmChannel.cancel(consumerTag);
            responseDeferred.resolve(Bus.FromSubscription(msg));
        }
        responsePromise = responseDeferred.promise;

        ackdPromise = Promise.resolve(this.ConfirmChannel.assertQueue(responseQueue, { durable: false, exclusive: true, autoDelete: true }))
            .then((okQueueReply) => this.ConfirmChannel.consume(responseQueue, handleResponse, { consumerTag: consumerTag }))
            .then((okSubscribeReply) => this.ConfirmChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => confirmPublish(Bus.rpcExchange, request.TypeID, Bus.ToBuffer(request), { type: request.TypeID, replyTo: responseQueue }))
            .then(this.handleAck, this.handleNack)
            .catch((failReason) => {
                //TODO: let throw
                console.error('[ERROR]Error requesting: %s', failReason);
                return false;
            });

        return { ackd: ackdPromise, response: responsePromise };
    }

    public Respond<Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(rqType: string, rsType: string, responder: (msg: Rq) => Promise<Rs>): Promise<{ consumerTag: string }> {
        return Promise.resolve(this.ConfirmChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => Promise.resolve(this.ConfirmChannel.assertQueue(rqType, { durable: true, exclusive: false, autoDelete: false })))
            .then((okQueueReply) => Promise.resolve(this.ConfirmChannel.bindQueue(rqType, Bus.rpcExchange, rqType)))
            .then((okBindReply) => this.ConfirmChannel.consume(rqType,
                (reqMsg) => {
                    //ack first
                    this.ConfirmChannel.ack(reqMsg);

                    //processing just the content
                    var payload = Bus.FromSubscription(reqMsg);
                    var replyTo = reqMsg.properties.replyTo;
                    var correlationId = reqMsg.properties.correlationId;
                    var reqType = reqMsg.properties.type;

                    var respMsgProm = responder(payload);

                    var confirmPublish = Promise.promisify(this.ConfirmChannel.publish, this.ConfirmChannel);

                    respMsgProm
                        .then((respMsg) => {
                            confirmPublish('', replyTo, Bus.ToBuffer(respMsg), { type: rsType, correlationId: correlationId })
                                .then(this.handleAck, this.handleNack);
                        });
                })
            )
            .catch((failReason) => {
                //TODO: let throw?
                console.error('[ERROR]Error creating response queue: %s', failReason);
                return null;
            });
    }

    // ========== Extended ==========
    public CancelConsumer(consumerTag: string): Promise<{ consumerTag: string }> {
        return Promise.resolve<{ consumerTag: string }>(this.ConfirmChannel.cancel(consumerTag));
    }

    public DeleteExchange(exchange: string, ifUnused: boolean = false): void {
        this.ConfirmChannel.deleteExchange(exchange, { ifUnused: ifUnused });
    }

    public DeleteQueue(queue: string, ifUnused: boolean = false, ifEmpty: boolean = false): Promise<{ messageCount: number }> {
        return Promise.resolve<{ messageCount: number }>(this.ConfirmChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty }));
    }

    public QueueStatus(queue: string): Promise<{ queue: string; messageCount: number; consumerCount: number; }> {
        return Promise.resolve<{queue: string; messageCount: number; consumerCount: number;}>(this.ConfirmChannel.checkQueue(queue));
    }
}