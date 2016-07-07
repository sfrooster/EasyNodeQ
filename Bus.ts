/// <reference path="./typings/index.d.ts" />

import * as amqp from 'amqplib';
import * as bbPromise from 'bluebird';
import * as uuid from 'node-uuid';

let amqpcm = require('amqp-connection-manager');


export class RabbitHutch {
    public static CreateBus(config: IBusConfig): IBus {
        var bus = new Bus(config);
        return bus;
    }
}

export class Bus implements IExtendedBus {

    private static rpcExchange = 'easy_net_q_rpc';
    private static rpcQueueBase = 'easynetq.response.';
    private static defaultErrorQueue = 'EasyNetQ_Default_Error_Queue';
    
    private Connection: bbPromise<amqp.Connection>;
    private connectionCM: any;
    private rpcQueue = null;
    private rpcResponseHandlers = {};

    private Channels: { publishChannel: amqp.Channel; rpcChannel: amqp.Channel; } = {
        publishChannel: null,
        rpcChannel: null
    }

    private channelsCM: { publishChannelCW: any; publishChannel: amqp.Channel; rpcChannel: amqp.Channel; } = {
        publishChannelCW: null,
        publishChannel: null,
        rpcChannel: null
    }

    private pubChanUp: bbPromise<boolean>;
    private rpcConsumerUp: bbPromise<boolean>;

    private static remove$type = (obj, recurse:boolean = true) => {
        try {
            delete obj.$type;
            var o;
            if (recurse) {
                for (o in obj) {
                    if (obj.hasOwnProperty(o) && obj[o] === Object(obj[o])) Bus.remove$type(obj[o]);
                }
            }
        }
        catch (e) {
            console.error('[Bus gulping error: %s]', e.message);
        }
    }

    // TODO: handle error for msg (can't stringify error)
    public SendToErrorQueue(msg: any, err: string = '', stack: string = '') {
        var errMsg = {
            TypeID: 'Common.ErrorMessage:Messages',
            Message: msg === void 0 ? null : JSON.stringify(msg),
            Error: err === void 0 ? null : err,
            Stack: stack === void 0 ? null : stack
        };

        return this.pubChanUp
            .then(() => this.Channels.publishChannel.assertQueue(Bus.defaultErrorQueue, { durable: true, exclusive: false, autoDelete: false }))
            .then(() => this.Send(Bus.defaultErrorQueue, errMsg));
    }

    constructor(public config: IBusConfig) {
        try {
            this.Connection = bbPromise.resolve(amqp.connect(config.url + (config.vhost !== null ? '/' + config.vhost : '') + '?heartbeat=' + config.heartbeat));
            this.connectionCM = amqpcm.connect(
                [config.url + (config.vhost !== null ? '/' + config.vhost : '')], // TODO - change config to support an array
                {
                    heartbeatIntervalInSeconds: config.heartbeat,
                    //json: true
                });

            this.connectionCM.on('connect', () => {
                console.log('Connected to broker');
                this.channelsCM.publishChannelCW = this.connectionCM.createChannel({
                    //json: true,
                    setup: (confChannel:amqp.Channel) => {
                        this.channelsCM.publishChannel = confChannel;
                        this.channelsCM.publishChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false });
                    }
                });
            });

            this.connectionCM.on('disconnect', (params) => {
                console.log('Disconnected from broker...', params.err.stack);
            });

            this.pubChanUp = this.Connection
                .then((connection) => connection.createConfirmChannel())
                .then((confChanReply) => {
                    this.Channels.publishChannel = confChanReply;
                    return true;
                });
        }
        catch (e) {
            console.log('[ERROR] - Connection problem %s', e);
        }
    }

    // ========== Publish / Subscribe ==========
    public Publish(msg: { TypeID: string }, withTopic:string = ''): bbPromise<boolean> {
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return bbPromise.reject(`${msg.TypeID} is not a valid TypeID`);
        }

        return this.pubChanUp
            .then(() => this.Channels.publishChannel.assertExchange(msg.TypeID, 'topic', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => this.Channels.publishChannel.publish(msg.TypeID, withTopic, Bus.ToBuffer(msg), { type: msg.TypeID }));
    }

    private doesPublishTypes = [];
    private doesPublish(type: { TypeID: string }):bbPromise<boolean> {
        console.log(this.doesPublishTypes);
        if (this.doesPublishTypes.indexOf(type.TypeID) === -1) {
            this.doesPublishTypes.push(type.TypeID);
            console.log('waiting to add setup...');
            return bbPromise.resolve(this.channelsCM.publishChannelCW
                .addSetup((confChannel:amqp.Channel) => confChannel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false }))
                .then(() => true));
        }
        else {
            return bbPromise.resolve(true);
        }
    }
    public PublishCM(msg: { TypeID: string }, withTopic:string = ''): bbPromise<boolean> {
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return bbPromise.reject(`${msg.TypeID} is not a valid TypeID`);
        }

        let r = this.doesPublish(msg)
            .then((x) => {
                console.log(x);
                return this.channelsCM.publishChannelCW.publish(msg.TypeID, withTopic, Bus.ToBuffer(msg), { type: msg.TypeID });
            });

        console.log(`>>> ${JSON.stringify(r)}`);

        return r;
    }

    public Subscribe(
        type: { TypeID: string },
        subscriberName: string,
        handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void,
        withTopic: string = '#'):
        bbPromise<IConsumerDispose>
    {
        if (typeof type.TypeID !== 'string' || type.TypeID.length === 0) {
            return bbPromise.reject(`${type.TypeID} is not a valid TypeID`);
        }

        if (typeof handler !== 'function') {
            return bbPromise.reject('xyz is not a valid function');
        }

        var queueID = type.TypeID + '_' + subscriberName;

        return this.Connection.then((connection) => {
            return bbPromise.resolve(connection.createChannel())
                .then((channel) => {
                    channel.prefetch(this.config.prefetch);
                    return channel.assertQueue(queueID, { durable: true, exclusive: false, autoDelete: false })
                        .then(() => channel.assertExchange(type.TypeID, 'topic', { durable: true, autoDelete: false }))
                        .then(() => channel.bindQueue(queueID, type.TypeID, withTopic))
                        .then(() => channel.consume(queueID, (msg: IPublishedObj) => {
                            if (msg) {
                                var _msg = Bus.FromSubscription(msg);

                                if (msg.properties.type === type.TypeID) {
                                    _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events

                                    var ackdOrNackd = false;

                                    handler(_msg, {
                                        ack: () => {
                                            channel.ack(msg);
                                            ackdOrNackd = true;
                                        },
                                        nack: () => {
                                            if (!msg.fields.redelivered) {
                                                channel.nack(msg);
                                            }
                                            else {
                                                //can only nack once
                                                this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                            }
                                            ackdOrNackd = true;
                                        }
                                    });

                                    if (!ackdOrNackd) channel.ack(msg);
                                }
                                else {
                                    this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} !== ${type.TypeID}`);
                                }
                            }
                        }))
                        .then((ctag) => {
                            return {
                                cancelConsumer: () => bbPromise.resolve(channel.cancel(ctag.consumerTag)
                                    .then(() => true)
                                    .catch(() => false))
                                ,
                                deleteQueue: () => bbPromise.resolve(channel.deleteQueue(queueID)
                                    .then(() => true)
                                    .catch(() => false))
                            }
                        });
                })
            });
    }

    // ========== Send / Receive ==========
    public Send(queue: string, msg: { TypeID: string }): bbPromise<boolean> {
        if (typeof msg.TypeID !== 'string' || msg.TypeID.length === 0) {
            return bbPromise.reject(`${msg.TypeID} is not a valid TypeID`);
        }

        return this.pubChanUp
            .then(() => this.Channels.publishChannel.sendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID }));
    }

    public Receive(
        rxType: { TypeID: string },
        queue: string,
        handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void):
        bbPromise<IConsumerDispose>
    {
        var channel = null;

        return this.Connection.then((connection) => {
            return bbPromise.resolve(connection.createChannel())
                .then((chanReply) => {
                    channel = chanReply;
                    return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
                })
                .then((okQueueReply) =>
                    channel.consume(queue, (msg) => {
                        if (msg) {
                            var _msg = Bus.FromSubscription(msg);

                            if (msg.properties.type === rxType.TypeID) {
                                _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events

                                var ackdOrNackd = false;

                                handler(_msg, {
                                    ack: () => {
                                        channel.ack(msg);
                                        ackdOrNackd = true;
                                    },
                                    nack: () => {
                                        if (!msg.fields.redelivered) {
                                            channel.nack(msg);
                                        }
                                        else {
                                            //can only nack once
                                            this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                        }
                                        ackdOrNackd = true;
                                    }
                                });

                                if (!ackdOrNackd) channel.ack(msg);
                            }
                            else {
                                this.SendToErrorQueue(_msg, `mismatched TypeID: ${msg.properties.type} !== ${rxType.TypeID}`);
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
                                }
                            }
                        })
                );
        });
    }

    public ReceiveTypes(
        queue: string,
        handlers: { rxType: { TypeID: string }; handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void }[]):
        bbPromise<IConsumerDispose>
    {
        var channel = null;

        return this.Connection.then((connection) => {
            return bbPromise.resolve(connection.createChannel())
                .then((chanReply) => {
                    channel = chanReply;
                    return channel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false });
                })
                .then((okQueueReply) =>
                    channel.consume(queue, (msg: IPublishedObj) => {
                        var _msg = Bus.FromSubscription(msg);
                        handlers.filter((handler) => handler.rxType.TypeID === msg.properties.type).forEach((handler) => {
                            _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events

                            var ackdOrNackd = false;

                            handler.handler(_msg, {
                                ack: () => {
                                    channel.ack(msg);
                                    ackdOrNackd = true;
                                },
                                nack: () => {
                                    if (!msg.fields.redelivered) {
                                        channel.nack(msg);
                                    }
                                    else {
                                        //can only nack once
                                        this.SendToErrorQueue(_msg, 'attempted to nack previously nack\'d message');
                                    }
                                    ackdOrNackd = true;
                                }
                            });

                            if (!ackdOrNackd) channel.ack(msg);
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
                                }
                            }
                        })
                );
        });
    }


    // ========== Request / Response ==========
    public Request(request: { TypeID: string }): bbPromise<any> {
        let resolver;
        let rejecter;
        var responsebbPromise = new bbPromise<any>((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
        });
        var correlationID = uuid.v4();

        this.rpcResponseHandlers[correlationID] = {
            resolver: resolver,
            rejecter: rejecter,
            timeoutID: setTimeout(() => {
                delete this.rpcResponseHandlers[correlationID];
                throw Error('Timed-out waiting for RPC response, correlationID: ' + correlationID);
            }, this.config.rpcTimeout || 30000)
        }

        this.rpcConsumerUp = this.rpcConsumerUp || this.Connection
            .then((connection) => connection.createChannel())
            .then((channelReply) => {
                this.Channels.rpcChannel = channelReply;
                this.rpcQueue = Bus.rpcQueueBase + uuid.v4();
                return this.Channels.rpcChannel.assertQueue(this.rpcQueue, { durable: false, exclusive: true, autoDelete: true });
            })
            .then((okQueueReply) => {
                return this.Channels.rpcChannel.consume(this.rpcQueue, (msg: IPublishedObj): void => {
                    if (this.rpcResponseHandlers[msg.properties.correlationId]) {
                        this.Channels.rpcChannel.ack(msg);

                        clearTimeout(this.rpcResponseHandlers[msg.properties.correlationId].timeoutID);

                        var _msg = Bus.FromSubscription(msg);
                        _msg.TypeID = _msg.TypeID || msg.properties.type;  //so we can get non-BusMessage events
                        this.rpcResponseHandlers[msg.properties.correlationId].resolver(_msg);
                        delete this.rpcResponseHandlers[msg.properties.correlationId];
                    }
                    else {
                        //ignore it?
                    }
                });
            })
            .then((okSubscribeReply) => {
                return true;
            });

        return this.rpcConsumerUp
            .then(() => this.Channels.publishChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false }))
            .then((okExchangeReply) => this.Channels.publishChannel.publish(Bus.rpcExchange, request.TypeID, Bus.ToBuffer(request), { type: request.TypeID, replyTo: this.rpcQueue, correlationId: correlationID }))
            .then((ackd) => responsebbPromise);
    }

    public Respond(
        rqType: { TypeID: string },
        rsType: { TypeID: string },
        responder: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => { TypeID: string }):
        bbPromise<IConsumerDispose> {
        return this.Connection
            .then((connection) => connection.createChannel())
            .then((responseChan) => {
                return responseChan.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })
                    .then((okExchangeReply) => responseChan.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false }))
                    .then((okQueueReply) => responseChan.bindQueue(rqType.TypeID, Bus.rpcExchange, rqType.TypeID))
                    .then((okBindReply) => responseChan.consume(rqType.TypeID, (reqMsg: IPublishedObj) => {
                        var msg = Bus.FromSubscription(reqMsg);

                        if (reqMsg.properties.type === rqType.TypeID) {
                            msg.TypeID = msg.TypeID || reqMsg.properties.type;  //so we can get non-BusMessage events

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
                            if (!ackdOrNackd) responseChan.ack(reqMsg);
                        }
                        else {
                            this.SendToErrorQueue(msg, `mismatched TypeID: ${reqMsg.properties.type} !== ${rqType.TypeID}`);
                        }
                    })
                        .then((ctag) => {
                            return {
                                cancelConsumer: () => bbPromise.resolve(responseChan.cancel(ctag.consumerTag)
                                    .then(() => true)
                                    .catch(() => false))
                                ,
                                deleteQueue: () => bbPromise.resolve(responseChan.deleteQueue(rqType.TypeID)
                                    .then(() => true)
                                    .catch(() => false))
                            }
                        }))
            });
    }

    public RespondAsync(
        rqType: { TypeID: string },
        rsType: { TypeID: string },
        responder: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => bbPromise<{ TypeID: string }>):
        bbPromise<IConsumerDispose>
    {
        return this.Connection
            .then((connection) => connection.createChannel())
            .then((responseChan) => {
                return responseChan.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })
                    .then((okExchangeReply) => responseChan.assertQueue(rqType.TypeID, { durable: true, exclusive: false, autoDelete: false }))
                    .then((okQueueReply) => responseChan.bindQueue(rqType.TypeID, Bus.rpcExchange, rqType.TypeID))
                    .then((okBindReply) => responseChan.consume(rqType.TypeID, (reqMsg: IPublishedObj) => {
                        var msg = Bus.FromSubscription(reqMsg);

                        if (reqMsg.properties.type === rqType.TypeID) {
                            msg.TypeID = msg.TypeID || reqMsg.properties.type;  //so we can get non-BusMessage events

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
                                if (!ackdOrNackd) responseChan.ack(reqMsg);
                            });
                        }
                        else {
                            this.SendToErrorQueue(msg, `mismatched TypeID: ${reqMsg.properties.type} !== ${rqType.TypeID}`)
                        }
                    })
                    .then((ctag) => {
                        return {
                            cancelConsumer: () => bbPromise.resolve(responseChan.cancel(ctag.consumerTag)
                                .then(() => true)
                                .catch(() => false))
                            ,
                            deleteQueue: () => bbPromise.resolve(responseChan.deleteQueue(rqType.TypeID)
                                .then(() => true)
                                .catch(() => false))
                        }
                    }))
                });
    }


    // ========== Etc  ==========
    private static ToBuffer(obj: any): NodeBuffer {
        Bus.remove$type(obj, false);
        return new Buffer(JSON.stringify(obj));
    }

    private static FromSubscription(obj: IPublishedObj): any {
        //fields: "{"consumerTag":"amq.ctag-QreMJ-zvC07EW2EKtWZhmQ","deliveryTag":1,"redelivered":false,"exchange":"","routingKey":"easynetq.response.0303b47c-2229-4557-9218-30c99c67f8c9"}"
        //props:  "{"headers":{},"deliveryMode":1,"correlationId":"14ac579e-048b-4c30-b909-50841cce3e44","type":"Common.TestMessageRequestAddValueResponse:Findly"}"
        var msg = JSON.parse(obj.content.toString());
        Bus.remove$type(msg);
        return msg;
    }

    // ========== Extended ==========
    public CancelConsumer(consumerTag: string): bbPromise<IQueueConsumeReply> {
        return bbPromise.resolve<IQueueConsumeReply>(this.Channels.publishChannel.cancel(consumerTag));
    }

    public DeleteExchange(exchange: string, ifUnused: boolean = false): void {
        this.Channels.publishChannel.deleteExchange(exchange, { ifUnused: ifUnused });
    }

    public DeleteQueue(queue: string, ifUnused: boolean = false, ifEmpty: boolean = false): bbPromise<{ messageCount: number }> {
        return bbPromise.resolve<{ messageCount: number }>(this.Channels.publishChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty }));
    }

    public DeleteQueueUnconditional(queue: string): bbPromise<{ messageCount: number }> {
        return bbPromise.resolve<{ messageCount: number }>(this.Channels.publishChannel.deleteQueue(queue));
    }

    public QueueStatus(queue: string): bbPromise<{ queue: string; messageCount: number; consumerCount: number; }> {
        return bbPromise.resolve<{ queue: string; messageCount: number; consumerCount: number; }>(this.Channels.publishChannel.checkQueue(queue));
    }
}

export interface IBus {
    Publish(msg: { TypeID: string }, withTopic?: string): bbPromise<boolean>;
    PublishCM(msg: { TypeID: string }, withTopic?: string): bbPromise<boolean>;
    Subscribe(type: { TypeID: string }, subscriberName: string, handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void, withTopic?:string): bbPromise<IConsumerDispose>;

    Send(queue: string, msg: { TypeID: string }): bbPromise<boolean>;
    Receive(rxType: { TypeID: string }, queue: string, handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void): bbPromise<IConsumerDispose>;
    ReceiveTypes(queue: string, handlers: { rxType: { TypeID: string }; handler: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => void }[]): bbPromise<IConsumerDispose>;

    Request(request: { TypeID: string }): bbPromise<{ TypeID: string }>;
    Respond(rqType: { TypeID: string }, rsType: { TypeID: string }, responder: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => { TypeID: string }): bbPromise<IConsumerDispose>
    RespondAsync(rqType: { TypeID: string }, rsType: { TypeID: string }, responder: (msg: { TypeID: string }, ackFns?: { ack: () => void; nack: () => void }) => bbPromise<{ TypeID: string }>): bbPromise<IConsumerDispose>

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
    DeleteQueue(queue: string, ifUnused: boolean, ifEmpty: boolean): bbPromise<{ messageCount: number }>;
    DeleteQueueUnconditional(queue: string): bbPromise<{ messageCount: number }>;
    QueueStatus(queue: string): bbPromise<{ queue: string; messageCount: number; consumerCount: number; }>;
}

interface IPublishedObj {
    content: NodeBuffer;
    fields: any;
    properties: any;
}

export interface IQueueConsumeReply {
    consumerTag: string;
}

export interface IConsumerDispose {
    cancelConsumer: () => bbPromise<boolean>;
    deleteQueue: () => bbPromise<boolean>;
}
