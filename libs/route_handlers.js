var helpers = require('./helper_functions');

module.exports = handlers = {
	v0: {
		voiceCallHandler: function(request, reply, next) {
			console.log(request.params)
			console.log('VOICE CALL HANDLER: To-', request.params.To, ' From- ', request.params.From, ' Status- ', request.params.CallStatus);
			helpers.voiceCallResponse(request.params).then(function(resp) {
				console.log('SENDING TWIML: ', resp)
				reply.setHeader('content-type', 'application/xml');
				reply.end(resp);
				return next();
			});
		},
		callStatusHandler: function(request, reply, next) {
			console.log('CALL STATUS HANDLER: ', request.params);
			helpers.callStatusResponse(request.params).then(function(resp) {
				 reply.send(200);
				 return next();
			});
		},
		callActionHandler: function(request, reply, next) {
			//todo
		}
	}
}