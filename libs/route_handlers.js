var helpers = require('./helper_functions');
var processor = require('./processor');

module.exports = handlers = {
	v0: {
		voiceCallHandler: function(request, reply, next) {
			var params = request.params;
			console.log(request.params)
			console.log('VOICE CALL HANDLER: To-', request.params.To, ' From- ', request.params.From, ' Status- ', request.params.CallStatus);
			params.route_type = 'call';
			processor.put(processor.inbound, params);
/*			helpers.voiceCallResponse(request.params).then(function(resp) {
				console.log('SENDING TWIML: ', resp)
				reply.setHeader('content-type', 'application/xml');
				reply.end(resp);
				return next();
			});
*/
		},
		smsHandler: function(request, reply, next) {
			var params = request.params;
			console.log(request.params)
			console.log('VOICE CALL HANDLER: To-', request.params.To, ' From- ', request.params.From, ' Status- ', request.params.CallStatus);
			params.route_type = 'call';
			processor.put(processor.inbound, params);
		},
		callStatusHandler: function(request, reply, next) {
			var params = request.params;
			params.route_type = 'status';
			processor.put(processor.inbound, params);
		},
		callActionHandler: function(request, reply, next) {
			var params = request.params;
			params.route_type = 'action';
			processor.put(processor.inbound, params);
		}
	}
}
