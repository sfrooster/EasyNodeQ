EasyNodeQ
=========

Intended to simplify and clarify the use of RabbitMQ, EasyNodeQ is a NodeJS implementation of and built to be interoperable with, the interactions created in Mike Hadlow's EasyNetQ which can be found [here](https://github.com/mikehadlow/EasyNetQ) and [here](http://easynetq.com/).

This project relies heavily on amqp.node (amqplib), which can be found [here](https://github.com/squaremo/amqp.node) and [here](http://www.squaremobius.net/amqp.node/).


Usage
-----
Note that all the examples here are in TypeScript but, of course, TypeScript is not required.

#### Create an instance of the bus
```
import {IBus, IBusConfig, IConsumerDispose, RabbitHutch} from 'easynodeq';

let config:IBusConfig = {
    heartbeat: 5,
    prefetch: 50,
    rpcTimeout: 10000,
    url: "amqp://<username>:<password>@<host>:<port>",
    vhost: "<your vhost here, if relevant>"
}

let bus = RabbitHutch.CreateBus(config);
```

#### Defining a Message
Keep in mind that EasyNodeQ was originally meant to interoperate with EasyNetQ and so some of what is below could be simplified for a Node-only situation.

```
class SomethingHappendEvent {
    public static TypeID: string = 'Your.NameSpace.Here.SomethingHappendEvent:Assembly.Name';
    public TypeID: string = 'Your.NameSpace.Here.SomethingHappendEvent:Assembly.Name';

    constructor(public EventNumberProperty: number, public EventStringProperty: string) {
    }
  }
  
  class SomeCommand {
    public static TypeID: string = 'Your.NameSpace.Here.SomeCommand:Assembly.Name';
    public TypeID: string = 'Your.NameSpace.Here.SomeCommand:Assembly.Name';

    constructor(public CommandNumberProperty: number, public CommandStringProperty: string) {
    }
  }
  ```
The two TypeID fields above are both necessary.  One static, one not, with the same values.  The TypeID's shown above will match a C# message called SomethingHappend, with a namespace of Your.NameSpace.Here, in an Assembly named Assembly.Name.dll and EasyNetQ will automatically instantiate it (and vice versa).

Of course you'll want their properties to match.  A good workflow is to define the messages in C# first, and then use T4TS found [here](https://www.nuget.org/packages/LionSoft.T4TS/) to decorate the class.  This will generate TypeScript interfaces which you can then use to create matching TypeScript message classes.

In a Node-only environment, the TypeIDs can be any unique string you want (they still need to match).

#### Use Your Bus and Messages (this is not exhaustive - I'm tired)

Publish / Subscribe
  ```
  // create a subscriber
  // a Promise<IConsumerDispose> will be returned which can be used to cancel the subscription
  // IBus.Subscribe(<Message Type>, "<subscriber name>", <handler>)
  let consumerCancellers: IConsumerDispose[] = [];
  bus.Subscribe(SomethingHappendEvent, "my_subscriber", (message:SomethingHappendEvent) => {
    console.log(`Got one: ${message.EventNumberProperty}, ${message.EventStringProperty}`);
  })
    .then(canceller => consumerCancellers.push(canceller));
  
  // elsewhere, publish - returns a Promise<boolean>
  bus.Publish(new SomethingHappendEvent(10, "Ten")
    .then(success => console.log(`was ${success ? "" : "not "} published`));
    
  // listen on a queue for SomeCommand messages
  let consumerCancellers: IConsumerDispose[] = [];
  bus.Receive(SomeCommand, "queue_name", (message:SomeCommand) => {
    console.log(`Got one: ${message.CommandNumberProperty}, ${message.CommandStringProperty}`);
  })
    .then(canceller => consumerCancellers.push(canceller));
    
  // elsewhere, send SomeCommand to a queue - returns a Promise<boolean>
  bus.Send(new SomeCommand(10, "Ten")
    .then(success => console.log(`was ${success ? "" : "not "} sent`));
    
  // finally - cancel the subscribers if you're done with them
  // returns a Promise<boolean> - use if you like
  consumerCancellers.forEach(canceller => canceller.cancelConsumer());
  
  // you can also delete the queues, if you like
  // also returns a Promise<boolean>
  consumerCancellers.forEach(canceller => canceller.deleteQueue());
  ```
