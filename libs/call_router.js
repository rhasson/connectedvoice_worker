'use strict';
var twilio = require('twilio');
var config = require('../config.json');
var csp = require('js-csp');
var when = require('when');
var gen = require('when/generator');
var _ = require('lodash');

class CallRouter {
	constructor() {
		this.client = new twilio.RestClient(config.twilio.production.account_sid, config.twilio.production.auth_token);
		this.activeCalls = new Map();
		this.pendingCalls = new Map();
		this.failedCalls = new Map();
		this.pendingTasks = new Map();
		this.activeTasks = new Map();

		this.callChannel = csp.chan(10);

		csp.go(this.processCalls.bind(this));
	}

	//queue new calls passing queue_sid, call_side, and params object
	queue(csid, userid, params) {
		params.id = userid;
		this.pendingCalls.set(csid, params);
		csp.putAsync(this.callChannel, params);
	}

	//remove a call from the pedingCall queue
	dequeue(csid, status) {
		if (status === 'hangup') {
			if (this.activeCalls.has(csid)) return this.activeCalls.delete(csid);
		} else if (status === 'queue-full' || status === 'system-error') {
			if (!this.pendingCalls.has(csid)) {
				if (this.activeCalls.has(csid)) {
					let call = this.activeCalls.get(csid);
					hangupCall(csid);
					return this.queue(csid, call);
				}
				if (this.failedCalls.has(csid)) {
					let call = this.failedCalls.get(csid);
					return this.queue(csid, call);
				}
			} //TODO: if failed but still in pending queue, re-queue it.  However need to set retry limits
		} else if (this.pendingCalls.has(csid)) return this.pendingCalls.delete(csid);
	}

	//returns boolean based on if the call sid is in the pending queue
	isQueued(csid) {
		return this.pendingCalls.has(csid) || this.activeCalls.has(csid);
	}

	//check if a particular call sid is in the active state
	isActive(csid) {
		console.log('isAction: ', csid)
		console.log('ACTIVE: ', this.activeCalls)
		return this.activeCalls.has(csid);
	}

	updateCallStatus(csid, params) {
		//
	}

	addTask(csid, task) {
		console.log('Adding Task to: ', csid)
		console.log('TASK: ', task)
		this.pendingTasks.set(csid, task);
	}

	getResponse(csid, userid) {
		let twiml = twilio.TwimlResponse();
		//let call = this.activeCalls.get(csid);

		twiml.dial({
			method: 'POST', 
			action: config.callbacks.ActionUrl.replace('%userid', userid),
		}, function(node) {
			node.queue(userid);  //userid is used as the queue name
		});

		return twiml;
	}

	* processCalls() {
		let self = this;
		let pending_call = yield csp.take(this.callChannel);
		while (pending_call !== csp.CLOSED) {
			console.log('Processing Call')
			let to_number = this.getToNumber(pending_call.CallSid, pending_call.index);
			console.log('TO: ', to_number)
			this.makeCall(to_number.phone_number, pending_call)
			.then(function(new_call) {
				console.log('NEW CALL: ', new_call)
				new_call.original_csid = pending_call.CallSid;
				self.pendingCalls.delete(pending_call.CallSid);
				let call = formatCallResponseData(new_call, pending_call.id)
				self.activeCalls.set(call.CallSid, call);
			})
			.fail(function(error) {
				console.log('Call attempt failed: ', error);
				try {
					let retries = ('_retries' in pending_call) ? pending_call['_retries'] : 3;
					retries--;
					pending_call['_retries'] = retries;

					if (pending_call['_retries'] > 0) {
						console.log('TRYING')
						csp.timeout(2000);
						self.queue(pending_call.CallSid, pending_call.id, pending_call);
					} else {
						console.log('Failed to place call after 3 tries.  Giving up');
						self.pendingCalls.delete(pending_call.CallSid);
					}
				}
				catch(e) {
					console.log('ERROR: ', e)
				}
			});
			pending_call = yield csp.take(this.callChannel);
		}
	}
	
	makeCall(to_number, params) {
		let userid = new Buffer(params.id, 'utf8').toString('base64');
		console.log('Making Call')
		let ret = this.client.accounts(params.AccountSid/*subaccount sid which owns the tn*/).calls.create({
			url: config.callbacks.ActionUrl.replace('%userid', userid) + '/' + params.index,
			method: 'POST',
			to: to_number,
			from: params.To,
			ifMachine: 'hangup',
			statusCallback: config.callbacks.StatusCallback.replace('%userid', userid),
			statusCallbackMethod: 'POST'
		});
		return ret;
	}

	getToNumber(csid, index) {
		//function *gen() { yield* array };  x = gen();  x.next()
		if (this.activeTasks.has(csid)) {
			let numbers = this.activeTasks.get(csid);
			let num = _.find(numbers, {'isUsed': false});
			let idx;
			if (num) {
				idx = _.indexOf(numbers, num);
				num.isUsed = true;
				numbers[idx] = num;
				this.activeTasks.set(csid, numbers);
				return num;
			} else {
				//all numbers are used up.  try again
				numbers = _.sortBy(_.map(numbers, (i) => { i.isUsed = false; return i; }), 'priority');
				numbers[0].isUsed = true;
				this.activeTasks.set(csid, numbers);
				return numbers[0];
			}
		} else {
			let tree = this.pendingTasks.get(csid);
			let actions = tree ? tree.findChildrenOfByHash('index', index, true) : [];
			let numbers;
			if (actions.length) {
				let nums = _.result(_.find(actions, {'verb': 'group'}), 'nouns.text');
				try { numbers = JSON.parse(nums) }
				catch(e) { return new Error('Failed to parse group numbers from IVR') }
				numbers = _.sortBy(_.map(numbers, (i) => { i.isUsed = false; return i; }), 'priority');  //initialize each number in the group as not used and sort by priority
				numbers[0].isUsed = true;
				this.activeTasks.set(csid, numbers);
				this.pendingTasks.delete(csid);
				return numbers[0];
			} else return new Error('No valid task found');
		}
	}
}

function formatCallResponseData(call, userid) {
	let c = {};
	_.assign(c, call);
	c.id = userid;
	c.CallSid = c.sid;
	c.AccountSid = c.account_sid;
	c.To = c.to;
	c.From = c.from;

	return c;
}


module.exports = new CallRouter();