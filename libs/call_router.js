/* @flow */

'use strict';
require('when/monitor/console');
var twilio = require('twilio');
var config = require('../config.json');
var when = require('when');
var gen = require('when/generator');
var csp = require('js-csp');
var db = require('./db');
var _ = require('lodash');

class CallRouter {
	// Flow annotations.
	
	/*:: client: Object; */
	/*:: activeCalls: Object; */
	/*:: pendingCalls: Object; */
	/*:: failedCalls: Object; */
	/*:: pendingTasks: Object; */
	/*:: activeTasks: Object; */
	/*:: callChannel: Object; */
	
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
	queue(csid/*: string*/, userid/*: string*/, params/*:Object*/) {
		params.id = userid;
		this.pendingCalls.set(csid, params);
		csp.putAsync(this.callChannel, params);
	}

	//remove a call from the pedingCall queue
	dequeue(csid/*: string*/, status/*: string*/) {
		let self = this;
		let promises = [];

		if (status === 'hangup') {
			let a_call = this.activeCalls.get(csid);
			let p_call = this.pendingCalls.get(csid);

			when.join(this.hangupCall(a_call),
					  this.hangupCall(p_call))
			.then(function(resp) {
				console.log('CLEARING STATE - ', resp)
				self.activeCalls.delete(csid);
				self.pendingCalls.delete(csid);
			})
			.catch(function(err) {
				console.log('CallRouter: Dequeue|hangup - failed to hangup call - ', err);
			});
		} else if (status === 'queue-full') {
			console.log('CallRouter: Dequeue|Queue-Full');
			this.activeCalls.delete(csid);
			this.pendingCalls.delete(csid);
		} else if (status === 'system-error' || status === 'error') {
			console.log('CallRouter: Dequeue|Error');
			if (this.activeCalls.has(csid)) {
				let call = this.activeCalls.get(csid);
				this.hangupCall(call.AccountSid, call.CallSid);
				self.activeCalls.delete(csid);
			}
			this.pendingCalls.delete(csid);
		} else if (status === 'bridged' || status === 'leave' || status === 'redirected') {
			let call = this.pendingCalls.get(csid);
			this.activeCalls.set(csid, call);
			this.pendingCalls.delete(csid);
		} else {
			this.cleanUpState(csid);
		}
	}

	//returns boolean based on if the call sid is in the pending queue
	isQueued(csid/*: string*/) /*: Boolean*/{
		return this.pendingCalls.has(csid) || this.activeCalls.has(csid);
	}

	//check if a particular call sid is in the active state
	isActive(csid/*: string*/) /*: Boolean*/{
		console.log('isActive: ', csid)
		return this.activeCalls.has(csid);
	}

	updateCallStatus(csid/*: string*/, status/*: string*/) {
		if (status === 'completed') this.cleanUpState(csid);
	}

	addTask(csid/*: string*/, task/*: Object*/) {
		console.log('Adding Task to: ', csid)
		console.log('TASK: ', task)
		this.pendingTasks.set(csid, task);
	}

	getResponse(csid/*: string*/, userid/*: string*/) /*: Object*/{
		let twiml = twilio.TwimlResponse();
		let call = this.activeCalls.get(csid);

		if (this.pendingCalls.has(call.original_csid)) {
			twiml.dial({
				method: 'POST', 
				action: config.callbacks.ActionUrl.replace('%userid', userid),
			}, function(node) {
				node.queue(userid);  //userid is used as the queue name
			});
		} else {
			twiml.say('We could not connect your call at this time.  Please try again later', {voice: 'woman'});
			twiml.hangup();
			this.cleanUpState(csid);
			this.cleanUpState(call.original_csid);
		}

		return twiml;
	}

	hangupCall(call/*: Object*/) /*: Object*/{
		console.log('Hanging up - ', call)
		if (!call) return when.resolve();

		return when(this.client.accounts(call.AccountSid).calls(call.CallSid).update({
			status: "completed"
		}));
	}
	* processCalls() /*: any*/{
		let self = this;
		let pending_call = yield csp.take(this.callChannel);
		while (pending_call !== csp.CLOSED) {
			console.log('Processing Call')
			if (pending_call != undefined) {
				gen.call(function* (csid, index) {
					try { 
						let to_number = yield self.getToNumber(csid, index);
						console.log('TO: ', to_number)
						if (to_number instanceof Error) throw new Error(to_number);
						if (to_number != undefined && pending_call != undefined) {
							let number = to_number.phone_number;
							self.makeCall(number, pending_call)
							.then(function(new_call) {
								console.log('NEW CALL: ', new_call)
								if (pending_call != undefined) {
									new_call.original_csid = pending_call.CallSid;
									let call = formatCallResponseData(new_call, pending_call.id)
									self.activeCalls.set(call.CallSid, call);
								}
							})
							.fail(function(error) {
								console.log('Call attempt failed: ', error);
								if (pending_call != undefined) {
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
								}
							});
						}
					} catch(e) { console.log('processCalls - getToNumber: failed to get number ', e); return false;}
				}, pending_call.CallSid, pending_call.index);
				//let to_number = this.getToNumber(pending_call.CallSid, pending_call.index);
			}
			pending_call = yield csp.take(this.callChannel);
		}
	}
	
	makeCall(number/*: string*/, params/*: Object*/) /*: Object*/{
		let userid = new Buffer(params.id, 'utf8').toString('base64');
		console.log('Making Call')
		let ret = this.client.accounts(params.AccountSid/*subaccount sid which owns the tn*/).calls.create({
			url: config.callbacks.ActionUrl.replace('%userid', userid) + '/' + params.index,
			method: 'POST',
			to: number,
			from: params.To,
			ifMachine: 'hangup',
			statusCallback: config.callbacks.StatusCallback.replace('%userid', userid),
			statusCallbackMethod: 'POST'
		});
		return ret;
	}

	getToNumber(csid/*: string*/, index/*: string*/) /*: any*/{
		//function *gen() { yield* array };  x = gen();  x.next()
		var self = this;
		if (this.activeTasks.has(csid)) {
			let numbers = this.activeTasks.get(csid);
			let num = _.find(numbers, {'isUsed': false});
			let idx;
			if (num) {
				idx = _.indexOf(numbers, num);
				num.isUsed = true;
				numbers[idx] = num;
				this.activeTasks.set(csid, numbers);
				return when.resolve(num);
			} else {
				//all numbers are used up.  try again
				numbers = _.sortBy(_.map(numbers, (i) => { i.isUsed = false; return i; }), 'priority');
				numbers[0].isUsed = true;
				this.activeTasks.set(csid, numbers);
				return when.resolve(numbers[0]);
			}
		} else {
			let tree = this.pendingTasks.get(csid);
			let actions = tree ? tree.findChildrenOfByHash('index', index, true) : [];
			let numbers;
			if (actions.length) {
				let group_id = _.result(_.find(actions, {'verb': 'group'}), 'nouns.text');
				return db.get(group_id).then(function(doc) {
					let body = doc.shift();
					if (body != undefined) {
						numbers = _.sortBy(_.map(body.members, (i) => { i.isUsed = false; return i; }), 'priority');  //initialize each number in the group as not used and sort by priority
						numbers[0].isUsed = true;
						self.activeTasks.set(csid, numbers);
						self.pendingTasks.delete(csid);
						return when.resolve(numbers[0]);
					} else return when.reject(new Error('Returned empty document when looking for group members'));
				})
				.catch(function(err) {
					return when.reject(new Error('Failed to get group members from database - ', err));
				});
			} else return when.reject(new Error('No valid task found'));
		}
	}

	cleanUpState(csid/*: string*/) {
		this.pendingCalls.delete(csid);
		this.activeCalls.delete(csid);
		this.pendingTasks.delete(csid);
		this.activeTasks.delete(csid);
	}
}

function formatCallResponseData(call/*: Object*/, userid/*: string*/) {
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