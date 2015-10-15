var helper = require('./helper_functions'),
	gen = require('when/generator'),
	twilio = require('twilio'),
	config = require('../config.json'),
	_ = require('lodash');

var csp = require('js-csp'),
	pub = csp.operations.pub,
	sub = csp.operations.pub.sub,
	unsub = csp.operations.pub.unsub,
	take = csp.take,
	put = csp.put,
	publisher = undefined;

var inbound = csp.chan(10),
	outbound = csp.chan(10),
	internal = {
		calls: csp.chan(10),
		sms: csp.chan(10),
		status: csp.chan(10),
		action: csp.chan(10),
		dequeue: csp.chan(10),
		wait: csp.chan(10)
	};

//array of state objects keyed by sid
//{current: string, previous: string, closed: boolean}
var STATE = [];  //memory leak as this variable will keep growing over time and number of calls

var processRequest = gen.lift(function*(params, route_type) {
	//get state object for CallSid
	var body = undefined;
	var state = update_state(params.CallSid, params.CallStatus);  //TODO: this is a memory leaky problem. need to fix
	
	try {
		switch(route_type) {
			case 'call':
				if (!state.closed) body = yield helper.voiceCallResponse(params);
				else body = yield helper.buildMessageTwiml('Failed to complete your call.  Goodbye');
				break;
			case 'sms':
				if (!state.closed) body = yield helper.smsResponse(params);
				else body = yield helper.buildMessageTwiml('Failed to complete your sms request.  Goodbye');
				break;
			case 'status':
				yield helper.callStatusResponse(params);
				body = undefined;
				break;
			case 'action':
				if (!state.closed) {
					if ('Digits' in params) body = yield helper.callActionGatherResponse(params);
					else if ('SmsSid' in params) body = yield helper.callActionSmsResponse(params);
					else if ('DialCallSid' in params) body = yield helper.callActionDialResponse(params);
					else body = yield helper.callActionRouterResponse(params);
				} else body = yield helper.buildMessageTwiml('The call has already ended.  Goodbye');
				break;
			case 'dequeue':
				body = yield helper.callDequeueReponse(params);
				break;
			case 'wait':
				body = yield helper.queueWaitReponse(params);
				break;
			default:
				body = undefined;
				break;
		}
		console.log('returning body')
		return body;
	} catch(e) {
		console.log('Error processing twiml request - ', e.stack);
		body = yield helper.buildMessageTwiml('An error was encountered, terminating session.  Goodbye');
		console.log('returning body error')
		return body;
	}
});

function getTopic(value) {
	return value.route_type;
}

//Setup the publisher based on route_types
publisher = pub(inbound, getTopic);

//CSP loop to to process call events
//Setup a subscriber to the 'call' type and feed it into call_channel
sub(publisher, 'call', internal.calls);
csp.go(function* () {
	var body;
	var isValid = false;
	var value = yield take(internal.calls);
	console.log('Starting inbound call channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function() {
				console.log('BAD')
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}

		value = yield take(internal.calls);
	}
});

//CSP loop to to process sms/mms events
//Setup a subscriber to the 'sms' type and feed it into sms_channel
sub(publisher, 'sms', internal.sms);
csp.go(function* () {
	var body;
	var value = yield take(internal.sms);
	console.log('Starting inbound sms channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');		
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function() {
				console.log('BAD')
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}

		value = yield take(internal.sms);
	}
});

//CSP loop to to process status events
//Setup a subscriber to the 'status' type and feed it into status_channel
sub(publisher, 'status', internal.status);
csp.go(function* () {
	var body;
	var value = yield take(internal.status);
	console.log('Starting inbound status channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function() {
				console.log('BAD')
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}
		
		value = yield take(internal.status);
	}
});

//CSP loop to to process action events
//Setup a subscriber to the 'action' type and feed it into action_channel
sub(publisher, 'action', internal.action);
csp.go(function* () {
	var body;
	var value = yield take(internal.action);
	console.log('Starting inbound action channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');
		//hack to get around bug in when library that doesn't unwrap nested promises
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function(e) {
				console.log('BAD: ', e)
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}

		value = yield take(internal.action);
	}
});

//CSP loop to to process queue events
//Setup a subscriber to the 'dequeue' type and feed it into action_channel
sub(publisher, 'dequeue', internal.action);
csp.go(function* () {
	var body;
	var value = yield take(internal.action);
	console.log('Starting inbound dequeue channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');
		//hack to get around bug in when library that doesn't unwrap nested promises
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function(e) {
				console.log('BAD: ', e)
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}

		value = yield take(internal.action);
	}
});

//CSP loop to to process wait events
//Setup a subscriber to the 'wait' type and feed it into action_channel
sub(publisher, 'wait', internal.action);
csp.go(function* () {
	var body;
	var value = yield take(internal.action);
	console.log('Starting inbound wait channel loop');
	while (value !== csp.CLOSED) {
		if (yield helper.verifyRequest(value.request)) {
			body = yield processRequest(value.request.params, value.route_type);
		} else body = yield helper.buildMessageTwiml('Failed to verify message.  Goodbye');
		//hack to get around bug in when library that doesn't unwrap nested promises
		if (typeof body === 'string') {
			value.body = body;
	 		csp.putAsync(outbound, value);
		} else if (typeof body === 'object') {
			body.then(function(resp){
				console.log('GOOD: ', resp)
				value.body = resp;
		 		csp.putAsync(outbound, value);
			}).catch(function(e) {
				console.log('BAD: ', e)
			});
		} else {
			value.body = undefined;
			csp.putAsync(outbound, value);
		}

		value = yield take(internal.action);
	}
});

//check if sid exists in global state object
//return state object for the sid
function get_state(sid) {
	var obj;

	if (STATE[sid]) return STATE[sid];
	else return undefined;
}

//updates the state object for a particular sid
//return updated state object
function update_state(sid, status) {
	var state = STATE[sid];

	if (!state) state = {current: status, previous: status, closed: false}

	state.previous = state.current;
	state.current = status;

	if (status === 'busy' || status === 'completed' || status === 'no-answer' || status === 'failed' || status === 'canceled') {
		state.closed = true;
	}

	STATE[sid] = state;
	return state;
}

module.exports = {
	inbound: inbound,
	outbound: outbound,
	take: csp.takeAsync,
	put: csp.putAsync,
	repl: {
		internal: internal,
		helpers: helper.repl
	}
}