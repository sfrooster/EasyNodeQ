var uuid = require('node-uuid');

var TestMessage = (function () {
    function TestMessage(Text) {
        this.Text = Text;
        this.TypeID = 'Bus.TestMessage:Bus';
        this.ID = null;
        this.ID = uuid.v4();
    }
    TestMessage.TypeID = 'Bus.TestMessage:Bus';
    return TestMessage;
})();
exports.TestMessage = TestMessage;

var TestMessageResponse = (function () {
    function TestMessageResponse(Text, SentText) {
        this.Text = Text;
        this.SentText = SentText;
        this.TypeID = 'Bus.TestMessageResponse:Bus';
        this.ID = null;
        this.ID = uuid.v4();
    }
    TestMessageResponse.TypeID = 'Bus.TestMessageResponse:Bus';
    return TestMessageResponse;
})();
exports.TestMessageResponse = TestMessageResponse;
//# sourceMappingURL=BusInterface.js.map
