export var ChannelStatus;
(function (ChannelStatus) {
    ChannelStatus[ChannelStatus["Open"] = 0] = "Open";
    ChannelStatus[ChannelStatus["Active"] = 1] = "Active";
    ChannelStatus[ChannelStatus["Settling"] = 2] = "Settling";
    ChannelStatus[ChannelStatus["Closed"] = 3] = "Closed";
    ChannelStatus[ChannelStatus["Disputed"] = 4] = "Disputed";
})(ChannelStatus || (ChannelStatus = {}));
export var PaymentMode;
(function (PaymentMode) {
    PaymentMode[PaymentMode["Prepaid"] = 0] = "Prepaid";
    PaymentMode[PaymentMode["Postpaid"] = 1] = "Postpaid";
})(PaymentMode || (PaymentMode = {}));
