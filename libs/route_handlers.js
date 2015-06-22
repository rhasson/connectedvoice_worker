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
			helpers.callStatusResponse(request.params).then(function(resp) {
				 reply.send(200);
				 return next();
			});
		},
		callActionHandler: function(request, reply, next) {
			if (checkHost(request.headers.host)) {
				helpers.callActionResponse(request.params).then(function(resp) {
					reply.setHeader('content-type', 'application/xml');
					reply.end(resp);
					return next();
				});
			} else {
				console.log('Ilegal host: ', request.headers)
				reply.send(403);
				return next();
			}
		}
	}
}

function checkHost(host) {
	if (process.env.NODE_ENV = 'development') return true;
	return /api.twilio.com/.test(host);
}