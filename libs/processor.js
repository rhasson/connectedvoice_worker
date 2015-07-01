var helper = require('./helper_functions'),
	gen = require('when/generator');

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
		status: csp.chan(10),
		action: csp.chan(10)
	};

//array of state objects keyed by sid
//{current: string, previous: string, closed: boolean}
var STATE = [];

var processRequest = gen.lift(function*(value) {
	//get state object for CallSid
	var params = value.request.params
	var state = update_state(params.CallSid, params.CallStatus);

	try {
		switch(value.route_type) {
			case 'call':
				if (!state.closed) value.body = yield helper.voiceCallResponse(params);
				else value.body = yield helper.buildMessageTwiml('Failed to complete your call.  Goodbye');
				break;
			case 'status':
				yield helper.callStatusResponse(params);
				value.body = undefined;
				break;
			case 'action':
				if (!state.closed) {
					if ('Digits' in params) value.body = yield helper.callActionGatherResponse(params);
					else if ('SmsSid' in params) value.body = yield helper.callActionSmsResponse(params);
					else if ('DialCallSid' in params) value.body = yield helper.callActionDialResponse(params);
					else value.body = undefined;
				} else value.body = yield helper.buildMessageTwiml('The call has already ended.  Goodbye');
				break;
			default:
				value.body = undefined;
				break;
		}
		delete value.request;
		put(outbound, value);
	} catch(e) {
		console.log('Error processing twiml request - ', e);
		value.body = yield helper.buildMessageTwiml('An error was encountered, terminating session.  Goodbye');
		delete value.request;
		put(outbound, value);
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
	var value = yield take(internal.calls);
	while (value !== csp.CLOSED) {
		yield processRequest(value);
		value = yield take(internal.calls);
	}
});

//CSP loop to to process status events
//Setup a subscriber to the 'status' type and feed it into status_channel
sub(publisher, 'status', internal.status);
csp.go(function* () {
	var value = yield take(internal.status);
	while (value !== csp.CLOSED) {
		yield processRequest(value);
		value = yield take(internal.status);
	}
});

//CSP loop to to process action events
//Setup a subscriber to the 'action' type and feed it into action_channel
sub(publisher, 'action', internal.action);
csp.go(function* () {
	var value = yield take(internal.action);
	while (value !== csp.CLOSED) {
		yield processRequest(value);
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
	put: csp.putAsync
}