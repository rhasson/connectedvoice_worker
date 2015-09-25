var _ = require('lodash'),
	config = require('../config.json'),
	when = require('when'),
	whennode = require('when/node'),
	gen = require('when/generator'),
	request = require('request'),
	TwimlParser = require('./twiml_parser'),
	TwimlResponse = require('twilio').TwimlResponse,
	twilio = require('twilio')(config.twilio.production.account_sid, config.twilio.production.auth_token),
	cloudant = require('cloudant')({
		account: config.cloudant.production.account,
		key: config.cloudant.production.key,
		password: config.cloudant.production.password
	}),
	db = cloudant.use(config.cloudant.production.db_name);

var dbinsert = whennode.lift(db.insert),
	dbsearch = whennode.lift(db.search),
	dbget = whennode.lift(db.get),
	dbremove = whennode.lift(db.destroy),
	http = whennode.lift(request);

var CACHE = [];

_.templateSettings.interpolate = /{([\s\S]+?)}/g;

module.exports = {
	voiceCallResponse: gen.lift(function*(params) {
		return yield _voiceCallResponse(params);
	}),
	smsResponse: gen.lift(function*(params) {
		return yield _smsResponse(params);
	}),
	callStatusResponse: gen.lift(function*(params) {
		return yield _callStatusResponse(params);
	}),
	callActionGatherResponse: gen.lift(function*(params) {
		return yield _callActionGatherResponse(params);
	}),
	callActionSmsResponse: gen.lift(function*(params) {
		return yield _callActionSmsResponse(params);
	}),
	callActionDialResponse: gen.lift(function*(params) {
		return yield _callActionDialResponse(params);
	}),
	buildMessageTwiml: gen.lift(function*(params) {
		return yield _buildMessageTwiml(params);
	})
}

function _voiceCallResponse(params) {
	var id;

	if (params.id) {
		id = new Buffer(params.id, 'base64').toString('utf8');
		console.log('ACCOUNT ID: ', id)
		return dbget(id).then(function(resp) {
			var doc = resp.shift();
			var ivr_id = _.result(_.find(doc.twilio.associated_numbers, {phone_number: params.To}), 'ivr_id');
			console.log('IVR ID: ', ivr_id)
			
			if (ivr_id !== undefined) return dbget(ivr_id);
			else return when.reject(new Error('Did not find an IVR record for the callee phone number'));
		})
		.then(function(resp) {
			var doc = resp.shift();
			var tResp = _buildIvrTwiml(doc.actions, params.id, params);
			if (typeof tResp === 'object') return webtaskRunApi(tResp);
			else return when.resolve(tResp);
		})
		.catch(function(err) {
			console.log('voiceCallResponse ERROR: ', err);
			return when.reject(new Error('voiceCallResponse error - failed to get record from DB'));
		});
	}
}

function _smsResponse(params) {
	var id;
/** TODO: implement SMS TWIML reponse
	if (params.id) {
		id = new Buffer(params.id, 'base64').toString('utf8');
		console.log('ACCOUNT ID: ', id)
		return dbget(id).then(function(resp) {
			var doc = resp.shift();
			var ivr_id = _.result(_.find(doc.twilio.associated_numbers, {phone_number: params.To}), 'ivr_id');
			console.log('IVR ID: ', ivr_id)
			
			if (ivr_id !== undefined) return dbget(ivr_id);
			else return when.reject(new Error('Did not find an IVR record for the callee phone number'));
		})
		.then(function(resp) {
			var doc = resp.shift();
			var tResp = _buildIvrTwiml(doc.actions, params.id, params);
			if (typeof tResp === 'object') return webtaskRunApi(tResp);
			else return when.resolve(tResp);
		})
		.catch(function(err) {
			console.log('voiceCallResponse ERROR: ', err);
			return when.reject(new Error('voiceCallResponse error - failed to get record from DB'));
		});
	}
*/
}

function _callStatusResponse(params) {
	console.log('STATUS REQUEST: PARAMS: ', params);
	var id = new Buffer(params.id, 'base64').toString('utf8');
	
	params.id = id;
	params.type = ('SmsSid' in params) ? 'sms_status' : 'call_status';

	return dbinsert(params).then(function(doc) {
		var body = doc.shift();
		if (!('ok' in body) || !body.ok) {
			console.log(body);
			return when.reject(new Error('Failed to save call status record to DB'));
		} else {
			return when.resolve(body);
		}
	});

	return when.resolve();
}

function _callActionGatherResponse(params) {
	console.log('ACTION GATHER REQUEST: PARAMS: ', params);
	var id = new Buffer(params.id, 'base64').toString('utf8');
	var tResp, action, gather;

	if (CACHE[id]) {
		//found entry in cache, build and respond with twiml
		//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
		gather = CACHE[id].gather;

		//check if the index provided in URL is that of a Gather verb
		if (gather.index === params.index) {
			//get the actions array based on the pressed ivr digit
			action = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions')[0];

			if (action && 'webtask_token' in action && action.webtask_token) return webtaskRunApi(action);
			else {
				tResp = _buildIvrTwiml(action, params.id, params);
				return when.resolve(tResp);
			}
		}
	}
	//entry not in cache, query database, cache entry and respond with twiml
	return dbget(id).then(function(resp) {
		var doc = resp.shift();
		var ivr_id = _.result(_.find(doc.twilio.associated_numbers, {phone_number: params.To}), 'ivr_id');
		console.log('IVR ID: ', ivr_id)
		
		if (ivr_id !== undefined) {
			CACHE[id] = {id: ivr_id};
			return dbget(ivr_id);
		}
		else return when.reject(new Error('Did not find an IVR record for the callee phone number'));
	})
	.then(function(resp) {
		var doc = resp.shift();
		var tResp, actions = [], gather = undefined;

		if (params.index) {
			//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
			gather = _.find(doc.actions, 'index', params.index);
		}
		if (!gather) { 
			//if we can't find the requested gather verb, grab the first one in the IVR
			gather = _.find(doc.actions, 'verb', 'gather');
		}
		if (gather.verb === 'gather') {
			//This is a Gather verb
			//cache it for future API calls
			CACHE[id].gather = gather;
			if ('Digits' in params) {
				//get the actions array based on the pressed ivr digit
				actions = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions');
			}
		}

		tResp = _buildIvrTwiml(actions, params.id, params); 
		console.log('Gather action - db done')

		if (typeof tResp === 'object') return webtaskRunApi(tResp);
		else return when.resolve(tResp);
	})
	.catch(function(err) {
		var msg;
		console.log('callActionResponse ERROR: ', err);
		return when.reject(new Error('callActionGatherResponse error - '+err.stack));
	});
}

function _callActionSmsResponse(params) {
	console.log('ACTION SMS REQUEST: PARAMS: ', params);
	var tResp = _buildMessageTwiml('Your message has been sent')
	
	return when.resolve(tResp);
}

function _callActionDialResponse(params) {
	console.log('ACTION DIAL REQUEST: PARAMS: ', params);
	var id = new Buffer(params.id, 'base64').toString('utf8');
	
	params.id = id;
	params.type = 'dial_status';

	return dbinsert(params).then(function(doc) {
		var body = doc.shift();
		if (!('ok' in body) || !body.ok) {
			return when.reject(new Error('Failed to save dial status record to DB'));
		} else {
			return when.resolve();
		}
	});
}

function _getIvrForUserId(id, to) {
	if (id) {
		id = new Buffer(id, 'base64').toString('utf8');
		console.log('ACCOUNT ID: ', id)
		return dbget(id).then(function(resp) {
			var doc = resp.shift();
			var ivr_id = _.result(_.find(doc.twilio.associated_numbers, {phone_number: to}), 'ivr_id');
			console.log('IVR ID: ', ivr_id)
			
			if (ivr_id !== undefined) return dbget(ivr_id);
			else return when.reject(new Error('Did not find an IVR record for the callee phone number'));
		})
		.then(function(resp) {
			var doc = resp.shift();
			return when.resolve(doc);
		});
	}
}

function _buildMessageTwiml(message) {
	var rTwiml = TwimlResponse();
	rTwiml.say(message, {
		voice: 'Woman',
		loop: 1,
		language: 'en'
	});
	rTwiml.hangup();
	return rTwiml.toString();
}

function _buildIvrTwiml(acts, userid, vars) {
	var rTwiml;// = TwimlResponse();
	var parser = new TwimlParser();
	var datetime = new Date()
	var params = cleanUp(vars);
	var task;
	var actions = _.cloneDeep(acts);


	if (!(actions instanceof Array)) actions = [actions];

	task = extractWebtaskTasks(actions);

	//console.log('EXTRACTED: ', task)

	if (task) {
		//right now only allow one webtask and no other twiml actions
		task.to = vars.To;
		task.from = vars.From;
		task.callSid = vars.CallSid;
		task.callStatus = vars.CallStatus;
		task.time = datetime.toTimeString();
		task.date = datetime.toDateString();
		delete task.verb;
		delete task.nouns;
		delete task.action_for;

		return task;
	}

	rTwiml = parser.create(actions).buildTwiml(TwimlResponse(), params, userid);

	function cleanUp(p) {
		return obj = {
			caller: p.Caller,
			callee: p.Called,
			digits: p.Digits,
			datetime: datetime,
			time: datetime.toTimeString(),
			date: datetime.toDateString()
		};
	}

	return rTwiml.toString();
}

function webtaskRunApi(task) {
	var token;
	if (task instanceof Array) task = task[0];
	token = task.webtask_token;

//console.log('TASK: ', task);
	//delete task.webtask_token;

console.log('CALL WEBTASK')
	return http({
		url: config.webtask.run 
			+ '/' + config.webtask.container
			+ '?key=' + token,
		method: 'POST',
		json: true,
		body: task
	}).then(function(resp) {
		var headers = resp.shift();
		var body = resp.shift();

		//console.log('HEADERS: ', headers)
		console.log('BODY: ', body)
		if (headers.statusCode === 200) {
			return when.resolve(body);
		} else {
			console.log('Webtask failed: ', headers.statusCode, ' = ', body);
			return when.reject(new Error('Failed to get response from webtask'));
		}
	}).catch(function(err) {
		console.log('Webtask run error: ', err);
		return when.reject(new Error('An error in the webtask was encountered'));
	});
}

function extractWebtaskTasks(arr) {
	return _.find(arr, {verb: 'webtask'});  //returns the first webtask action it finds or undefined
}