var ampq = require('amqplib');
var ifBus = require('./interfaces/BusInterface');
var Promise = require('bluebird');
var uuid = require('node-uuid');

var Bus = (function () {
    function Bus(config) {
        var _this = this;
        this.ConfirmChannel = null;
        this.Connection = null;
        var handleChannelErrorBound = this.handleChannelError.bind(this);
        var handleChannelCloseBound = this.handleChannelClose.bind(this);

        this.Start = Promise.resolve(ampq.connect(config.url + (config.vhost !== null ? '/' + config.vhost : '') + '?heartbeat=' + config.heartbeat)).then(function (connection) {
            _this.Connection = connection;
            return Promise.resolve(connection.createConfirmChannel());
        }).then(function (channel) {
            _this.ConfirmChannel = channel;
            channel.on('error', handleChannelErrorBound);
            channel.on('close', handleChannelCloseBound);
            channel.prefetch(config.prefetch);
            return { success: true };
        }).catch(function (failReason) {
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
    Bus.ToBuffer = function (obj) {
        return new Buffer(JSON.stringify(obj));
    };

    Bus.FromBuffer = function (buffer) {
        return JSON.parse(buffer.toString());
    };

    Bus.FromSubscription = function (obj) {
        return JSON.parse(obj.content.toString());
    };

    Bus.prototype.handleChannelClose = function () {
        console.log('[LOG] - Channel close called...');
        //TODO do something here?
    };

    Bus.prototype.handleChannelError = function (error) {
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
    };

    Bus.prototype.handleAck = function () {
        return true;
    };

    Bus.prototype.handleNack = function (err) {
        return false;
    };

    Bus.prototype.RunBusTest = function (log) {
        var _this = this;
        if (typeof log === "undefined") { log = true; }
        return this.Start.then(function (started) {
            if (started.success) {
                var testResult = _this.TestBus();

                if (log) {
                    testResult.Publish.then(function (success) {
                        return console.log('[TEST] - PUBLISH: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Subscribe.then(function (success) {
                        return console.log('[TEST] - SUBSCRIBE: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Send.then(function (success) {
                        return console.log('[TEST] - SEND: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Receive.then(function (success) {
                        return console.log('[TEST] - RECEIVE: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.ReceiveTypes.then(function (success) {
                        return console.log('[TEST] - RECEIVE TYPES: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Request.then(function (success) {
                        return console.log('[TEST] - REQUEST: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Response.then(function (success) {
                        return console.log('[TEST] - RESPONSE: %s', success ? 'PASS' : 'FAIL');
                    });
                    testResult.Aggregate.then(function (success) {
                        return console.log('[TEST] - OVERALL: %s', success ? 'PASS' : 'FAIL');
                    });
                }

                return testResult.Aggregate;
            } else {
            }
        });
    };

    Bus.prototype.TestBus = function () {
        var _this = this;
        var aggregateDeferred = Promise.defer();
        var publishDeferred = Promise.defer();
        var subscribeDeferred = Promise.defer();
        var sendDeferred = Promise.defer();
        var receiveDeferred = Promise.defer();
        var receiveTypeDeferred = Promise.defer();
        var requestDeferred = Promise.defer();
        var responseDeferred = Promise.defer();
        var requestRespondTest_CTag = null;
        var pubSubTest_CTag = null;
        var sendReceiveTest_CTag = null;
        var sendReceiveTypedTest_CTag = null;

        var testSubId = 'test-' + uuid.v4();
        var testQueue = 'testQueue-' + uuid.v4();
        var testQueueTyped = testQueue + '-Typed';

        this.Start.then(function (started) {
            if (started.success) {
                _this.Respond(ifBus.TestMessage.TypeID, ifBus.TestMessageResponse.TypeID, function (msg) {
                    requestDeferred.resolve(true);
                    var resp = new ifBus.TestMessageResponse('my response', msg.Text);
                    return Promise.cast(resp);
                }).then(function (ctag) {
                    requestRespondTest_CTag = ctag.consumerTag;
                    _this.Request(new ifBus.TestMessage('my request'));
                }).then(function (apcr) {
                    responseDeferred.resolve(true);
                }).done();

                _this.Subscribe(testSubId, ifBus.TestMessage.TypeID, function (msg) {
                    publishDeferred.resolve(true);
                    subscribeDeferred.resolve(true);
                }).then(function (ctag) {
                    pubSubTest_CTag = ctag.consumerTag;
                    _this.Publish(new ifBus.TestMessage('publish'));
                }).done();

                _this.Receive(testQueue, function (msg) {
                    sendDeferred.resolve(true);
                    receiveDeferred.resolve(true);
                }).then(function (ctag) {
                    sendReceiveTest_CTag = ctag.consumerTag;
                    _this.Send(testQueue, new ifBus.TestMessage('send'));
                }).done();

                _this.ReceiveTypes(testQueueTyped, [{
                        type: ifBus.TestMessage.TypeID, handler: function (msg) {
                            receiveTypeDeferred.resolve(true);
                        }
                    }]).then(function (ctag) {
                    sendReceiveTypedTest_CTag = ctag.consumerTag;
                    _this.Send(testQueueTyped, new ifBus.TestMessage('send'));
                }).catch(function (failreason) {
                    receiveTypeDeferred.reject(failreason);
                }).done();
            }
        });

        Promise.all([publishDeferred.promise, subscribeDeferred.promise, sendDeferred.promise, receiveDeferred.promise, receiveTypeDeferred.promise, requestDeferred.promise, responseDeferred.promise]).then(function (vals) {
            _this.CancelConsumer(requestRespondTest_CTag).then(function (cancelReply) {
                return _this.DeleteQueue(ifBus.TestMessage.TypeID, true, true);
            }).then(function (deleteReply) {
                return _this.DeleteExchange(ifBus.TestMessage.TypeID, true);
            });

            _this.CancelConsumer(pubSubTest_CTag).then(function (cancelReply) {
                _this.DeleteQueue(ifBus.TestMessage.TypeID + '_' + testSubId, true, true);
            });

            _this.CancelConsumer(sendReceiveTest_CTag).then(function (cancelReply) {
                _this.DeleteQueue(testQueue, true, true);
            });

            _this.CancelConsumer(sendReceiveTypedTest_CTag).then(function (cancelReply) {
                _this.DeleteQueue(testQueueTyped, true, true);
            });

            aggregateDeferred.resolve(vals.every(function (val) {
                return val;
            }));
        });

        return { Aggregate: aggregateDeferred.promise, Publish: publishDeferred.promise, Subscribe: subscribeDeferred.promise, Send: sendDeferred.promise, Receive: receiveDeferred.promise, ReceiveTypes: receiveTypeDeferred.promise, Request: requestDeferred.promise, Response: responseDeferred.promise };
    };

    // ========== Publish / Subscribe ==========
    Bus.prototype.Publish = function (obj) {
        //TODO use everywhere - make "global"
        var confirmPublish = Promise.promisify(this.ConfirmChannel.publish, this.ConfirmChannel);

        return Promise.resolve(this.ConfirmChannel.assertExchange(obj.TypeID, 'topic', { durable: true, autoDelete: false })).then(function (okExchangeReply) {
            return confirmPublish(obj.TypeID, '', Bus.ToBuffer(obj), { type: obj.TypeID });
        }).then(this.handleAck, this.handleNack).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error publishing: %s', failReason);
            return false;
        });
    };

    Bus.prototype.Subscribe = function (subscriberName, type, handler) {
        var _this = this;
        var queueId = type + '_' + subscriberName;

        return Promise.resolve(this.ConfirmChannel.assertQueue(queueId, { durable: true, exclusive: false, autoDelete: false })).then(function (okQueueReply) {
            return Promise.resolve(_this.ConfirmChannel.assertExchange(type, 'topic', { durable: true, autoDelete: false }));
        }).then(function (okExchangeReply) {
            return Promise.resolve(_this.ConfirmChannel.bindQueue(queueId, type, ''));
        }).then(function (okBindReply) {
            return _this.ConfirmChannel.consume(queueId, function (msg) {
                //ack first
                _this.ConfirmChannel.ack(msg);
                handler(Bus.FromSubscription(msg));
            });
        }).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error creating consumer: %s', failReason);
            return null;
        });
    };

    // ========== Send / Receive ==========
    Bus.prototype.Send = function (queue, msg) {
        var confirmSendToQueue = Promise.promisify(this.ConfirmChannel.sendToQueue, this.ConfirmChannel);

        return confirmSendToQueue(queue, Bus.ToBuffer(msg), { type: msg.TypeID }).then(this.handleAck, this.handleNack).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error publishing: %s', failReason);
            return false;
        });
    };

    Bus.prototype.Receive = function (queue, handler) {
        var _this = this;
        return Promise.resolve(this.ConfirmChannel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false })).then(function (okQueueReply) {
            return _this.ConfirmChannel.consume(queue, function (msg) {
                //ack first
                _this.ConfirmChannel.ack(msg);
                var unWrapMsg = Bus.FromSubscription(msg);
                handler(unWrapMsg);
            });
        }).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error creating consumer: %s', failReason);
            return null;
        });
    };

    Bus.prototype.ReceiveTypes = function (queue, handlers) {
        var _this = this;
        return Promise.resolve(this.ConfirmChannel.assertQueue(queue, { durable: true, exclusive: false, autoDelete: false })).then(function (okQueueReply) {
            return _this.ConfirmChannel.consume(queue, function (msg) {
                //ack first
                _this.ConfirmChannel.ack(msg);
                var unWrapMsg = Bus.FromSubscription(msg);
                handlers.filter(function (handler) {
                    return handler.type === msg.properties.type;
                }).forEach(function (handler) {
                    handler.handler(unWrapMsg);
                });
            });
        }).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error creating consumer: %s', failReason);
            return null;
        });
    };

    // ========== Request / Response ==========
    Bus.prototype.Request = function (request) {
        var _this = this;
        var ackdPromise;
        var responsePromise;

        var confirmPublish = Promise.promisify(this.ConfirmChannel.publish, this.ConfirmChannel);

        var consumerTag = uuid.v4();
        var responseQueue = Bus.rpcQueueBase + consumerTag;

        var responseDeferred = Promise.defer();
        var handleResponse = function (msg) {
            //ack first
            _this.ConfirmChannel.ack(msg);
            _this.ConfirmChannel.cancel(consumerTag);
            responseDeferred.resolve(Bus.FromSubscription(msg));
        };
        responsePromise = responseDeferred.promise;

        ackdPromise = Promise.resolve(this.ConfirmChannel.assertQueue(responseQueue, { durable: false, exclusive: true, autoDelete: true })).then(function (okQueueReply) {
            return _this.ConfirmChannel.consume(responseQueue, handleResponse, { consumerTag: consumerTag });
        }).then(function (okSubscribeReply) {
            return _this.ConfirmChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false });
        }).then(function (okExchangeReply) {
            return confirmPublish(Bus.rpcExchange, request.TypeID, Bus.ToBuffer(request), { type: request.TypeID, replyTo: responseQueue });
        }).then(this.handleAck, this.handleNack).catch(function (failReason) {
            //TODO: let throw
            console.error('[ERROR]Error requesting: %s', failReason);
            return false;
        });

        return { ackd: ackdPromise, response: responsePromise };
    };

    Bus.prototype.Respond = function (rqType, rsType, responder) {
        var _this = this;
        return Promise.resolve(this.ConfirmChannel.assertExchange(Bus.rpcExchange, 'direct', { durable: true, autoDelete: false })).then(function (okExchangeReply) {
            return Promise.resolve(_this.ConfirmChannel.assertQueue(rqType, { durable: true, exclusive: false, autoDelete: false }));
        }).then(function (okQueueReply) {
            return Promise.resolve(_this.ConfirmChannel.bindQueue(rqType, Bus.rpcExchange, rqType));
        }).then(function (okBindReply) {
            return _this.ConfirmChannel.consume(rqType, function (reqMsg) {
                //ack first
                _this.ConfirmChannel.ack(reqMsg);

                //processing just the content
                var payload = Bus.FromSubscription(reqMsg);
                var replyTo = reqMsg.properties.replyTo;
                var correlationId = reqMsg.properties.correlationId;
                var reqType = reqMsg.properties.type;

                var respMsgProm = responder(payload);

                var confirmPublish = Promise.promisify(_this.ConfirmChannel.publish, _this.ConfirmChannel);

                respMsgProm.then(function (respMsg) {
                    confirmPublish('', replyTo, Bus.ToBuffer(respMsg), { type: rsType, correlationId: correlationId }).then(_this.handleAck, _this.handleNack);
                });
            });
        }).catch(function (failReason) {
            //TODO: let throw?
            console.error('[ERROR]Error creating response queue: %s', failReason);
            return null;
        });
    };

    // ========== Extended ==========
    Bus.prototype.CancelConsumer = function (consumerTag) {
        return Promise.resolve(this.ConfirmChannel.cancel(consumerTag));
    };

    Bus.prototype.DeleteExchange = function (exchange, ifUnused) {
        if (typeof ifUnused === "undefined") { ifUnused = false; }
        this.ConfirmChannel.deleteExchange(exchange, { ifUnused: ifUnused });
    };

    Bus.prototype.DeleteQueue = function (queue, ifUnused, ifEmpty) {
        if (typeof ifUnused === "undefined") { ifUnused = false; }
        if (typeof ifEmpty === "undefined") { ifEmpty = false; }
        return Promise.resolve(this.ConfirmChannel.deleteQueue(queue, { ifUnused: ifUnused, ifEmpty: ifEmpty }));
    };

    Bus.prototype.QueueStatus = function (queue) {
        return Promise.resolve(this.ConfirmChannel.checkQueue(queue));
    };
    Bus.rpcQueueBase = 'easynetq.response.';
    Bus.rpcExchange = 'easy_net_q_rpc';
    return Bus;
})();
exports.Bus = Bus;
//# sourceMappingURL=Bus.js.map
