/// <reference path='../scripts/typings/bluebird/bluebird.d.ts' />
/// <reference path='../scripts/typings/express/express.d.ts' />
/// <reference path='../scripts/typings/node/node.d.ts' />
/// <reference path='../../Findly.Domain.NodeProcessors/T4TS.d.ts' />

import express = require('express');
import Promise = require('bluebird');
import ifBus = require('./interfaces/BusInterface');
import ifHttpBus = require('./interfaces/HttpBusInterface');
var uuid = require('node-uuid');


export class HttpBus implements ifHttpBus.IHttpBus {

    public Publish: (req: express.Request, res: express.Response) => void;
    public Send: (req: express.Request, res: express.Response) => void;
    public Request: <Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(req: express.Request, res: express.Response) => void;

    constructor(private bus: ifBus.IBus) {
        this.Publish = (req: express.Request, res: express.Response) => {
            var msg: ifBusCS.IPublishable = req.body;

            //this.bus.Started...
            this.bus.Publish(msg)
                .then((ackd) => {
                    ackd ? res.jsonp(200, { success: ackd }) : res.jsonp(200, { success: ackd, reason: 'nackd' });
                })
                .catch((failReason) => {
                    res.jsonp(500, { success: false, reason: failReason })
                });
        }

        this.Send = (req: express.Request, res: express.Response) => {
            var sendInfo: ifHttpBus.IHttpSendable = req.body;

            //this.bus.Started...
            this.bus.Send(sendInfo.queue, sendInfo.message)
                .then((ackd) => {
                    ackd ? res.jsonp(200, { success: ackd }) : res.jsonp(200, { success: ackd, reason: 'nackd' });
                })
                .catch((failReason) => {
                    res.jsonp(500, { success: false, reason: failReason });
                });
        }

        this.Request = <Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(req: express.Request, res: express.Response) => {
            var msg: Rq = req.body;

            //this.bus.Started...
            var ackandRespProms = this.bus.Request(msg);

            //TODO: ackd = false, resp not falsey or truthy
            Promise.all([ackandRespProms.ackd, ackandRespProms.response])
                .then((ackandResp) => {
                    if (ackandResp[0]) res.jsonp(200, { success: true, result: ackandResp[1] });
                    else res.jsonp(200, { success: false, reason: 'nackd' });

                })
                .catch((failReason) => {
                    res.jsonp(500, { success: false, reason: failReason });
                });
        }
    }
}