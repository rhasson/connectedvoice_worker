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
		process_calls(value);
		value = yield take(internal.calls);
	}
});

function process_calls(value) {
	//get state object for CallSid
	var params = value.request.params
	var state = update_state(params.CallSid, params.CallStatus);
	if (!state.closed) {
		//get IVR from DB
		gen.call(function*(val, p) {
			let twiml;
			try {
				twiml = yield helper.voiceCallResponse(p);
				val.body = twiml;
				put(outbound, val);
			} catch(e) {
				handleError(e);
			}
		}, value, params);
	} else {
		gen.call(function*(val) {
			try {
				let twiml;
				twiml = yield helper.buildErrorTwiml('Failed to complete your call.  Goodbye');
				val.body = twiml;
				put(outbound, val);
			} catch(e) {
				handleError(e);
			}
		}, value);
	}
}

//CSP loop to to process status events
//Setup a subscriber to the 'status' type and feed it into status_channel
sub(publisher, 'status', internal.status);
csp.go(function* () {
	var value = yield take(internal.status);
	while (value !== csp.CLOSED) {
		process_status(value);
		value = yield take(internal.status);
	}
});

function process_status(value) {
	//get state object for CallSid
	var params = value.request.params
	var state = update_state(params.CallSid, params.CallStatus);
	if (state.closed) {
		//get IVR from DB
		gen.call(function*(val, p) {
			let twiml;
			try {
				yield helper.callStatusResponse(p);
				val.body = undefined;
				put(outbound, val);
			} catch(e) {
				handleError(e);
			}
		}, value, params);
	} else {
		console.log('State open after receiving status message: ', value);
	}
}

//CSP loop to to process action events
//Setup a subscriber to the 'action' type and feed it into action_channel
sub(publisher, 'action', internal.action);
csp.go(function* () {
	var value = yield take(internal.action);
	while (value !== csp.CLOSED) {
		process_action(value);
		value = yield take(internal.action);
	}
});

function process_action(value) {
	var params = value.request.params
	var state = update_state(params.CallSid, params.CallStatus);
	if (!state.closed) {
		//TODO: process different actions and respond based on gather digits, sms sending action, etc
		gen.call(function*(val, p) {
			let twiml;
			try {
				if ('Digits' in p) twiml = yield helper.callActionGatherResponse(p);
				else if ('SmsSid' in p) twiml = yield helper.callActionSmsResponse(p);
				val.body = twiml;
				put(outbound, val);
			} catch(e) {
				handleError(e);
			}
		}, value, params);
	} else {
		gen.call(function*(val) {
			try {
				let twiml = yield helper.buildErrorTwiml('Failed to complete your call.  Goodbye');
				val.body = twiml;
				put(outbound, val);
			} catch(e) {
				handleError(e);
			}
		}, value);
	}
}

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

//handles errors thrown by calls to DB
function handleError(err) {
	console.log('ERROR: ', err);
}

module.exports = {
	inbound: inbound,
	outbound: outbound,
	take: csp.takeAsync,
	put: csp.putAsync
}