var Promise = require('bluebird');

var uuid = require('node-uuid');

var HttpBus = (function () {
    function HttpBus(bus) {
        var _this = this;
        this.bus = bus;
        this.Publish = function (req, res) {
            var msg = req.body;

            //this.bus.Started...
            _this.bus.Publish(msg).then(function (ackd) {
                ackd ? res.jsonp(200, { success: ackd }) : res.jsonp(200, { success: ackd, reason: 'nackd' });
            }).catch(function (failReason) {
                res.jsonp(500, { success: false, reason: failReason });
            });
        };

        this.Send = function (req, res) {
            var sendInfo = req.body;

            //this.bus.Started...
            _this.bus.Send(sendInfo.queue, sendInfo.message).then(function (ackd) {
                ackd ? res.jsonp(200, { success: ackd }) : res.jsonp(200, { success: ackd, reason: 'nackd' });
            }).catch(function (failReason) {
                res.jsonp(500, { success: false, reason: failReason });
            });
        };

        this.Request = function (req, res) {
            var msg = req.body;

            //this.bus.Started...
            var ackandRespProms = _this.bus.Request(msg);

            //TODO: ackd = false, resp not falsey or truthy
            Promise.all([ackandRespProms.ackd, ackandRespProms.response]).then(function (ackandResp) {
                if (ackandResp[0])
                    res.jsonp(200, { success: true, result: ackandResp[1] });
                else
                    res.jsonp(200, { success: false, reason: 'nackd' });
            }).catch(function (failReason) {
                res.jsonp(500, { success: false, reason: failReason });
            });
        };
    }
    return HttpBus;
})();
exports.HttpBus = HttpBus;
//# sourceMappingURL=HttpBus.js.map
