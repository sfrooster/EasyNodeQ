import express = require('express');
import ifBus = require('./BusInterface');

export interface IHttpSendable {
    queue: string;
    message: ifBusCS.IPublishable;
}

export interface IHttpBus {
    //Publish(msg: mBus.IPublishable): Promise<boolean>;
    Publish(req: express.Request, res: express.Response): void;
    //Subscribe(subscriberName: string, type: string, handler: (msg: IPublishable) => void): Promise<IQueueConsumeReply>;

    Send(req: express.Request, res: express.Response): void;
    //Receive(queue: string, handler: (msg: IPublishable) => void): Promise<IQueueConsumeReply>;
    //ReceiveTypes(queue: string, handlers: { type: string; handler: (msg: IPublishable) => void }[]): Promise<IQueueConsumeReply>;

    //Request<Rq extends IPublishable, Rs extends IPublishable>(msg: Rq): Promise<Rs>;
    //Request<Rq extends mBus.IPublishable, Rs extends mBus.IPublishable>(request: Rq): { ackd: Promise<boolean>; response: Promise<Rs> };
    Request<Rq extends ifBusCS.IPublishable, Rs extends ifBusCS.IPublishable>(req: express.Request, res: express.Response): void;
    //Respond<Rq extends IPublishable, Rs extends IPublishable>(rqType: string, rsType: string, responder: (msg: Rq) => Promise<Rs>): Promise<IQueueConsumeReply>
}