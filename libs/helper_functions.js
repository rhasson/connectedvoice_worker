var _ = require('lodash'),
	config = require('../config.json'),
	when = require('when'),
	whennode = require('when/node'),
	gen = require('when/generator'),
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
	dbremove = whennode.lift(db.destroy);

var CACHE = [];

_.templateSettings.interpolate = /{([\s\S]+?)}/g;

module.exports = {
	voiceCallResponse: gen.lift(function*(params) {
		return yield _voiceCallResponse(params);
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
			return when.resolve(tResp);
		})
		.catch(function(err) {
			console.log('voiceCallResponse ERROR: ', err);
			return when.reject(new Error('voiceCallResponse error - failed to get record from DB'));
		});
	}
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
}

function _callActionGatherResponse(params) {
	console.log('ACTION REQUEST: PARAMS: ', params);
	var id = new Buffer(params.id, 'base64').toString('utf8');
	var tResp, actions, gather;

	if (CACHE[id]) {
		//found entry in cache, build and respond with twiml
		//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
		gather = CACHE[id].gather;

		//check if the index provided in URL is that of a Gather verb
		if (gather.index === params.index) {
			//get the actions array based on the pressed ivr digit
			actions = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions');

			tResp = _buildIvrTwiml(actions, params.id, params);

			return when.resolve(tResp);
		} else {
			console.log('Gather index did not match');
			return when.reject(new Error('Failed to find Gather'));
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
		var tResp, actions = [], gather;

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

		return when.resolve(tResp);
	})
	.catch(function(err) {
		var msg, tResp;
		console.log('callActionResponse ERROR: ', err);
		return when.reject(new Error('callActionGatherResponse error - '+err));
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
			console.log(body);
			return when.reject(new Error('Failed to save dial status record to DB'));
		} else {
			return when.resolve();
		}
	});
}

/*
function _callActionResponse(params) {
	console.log('ACTION REQUEST: PARAMS: ', params);
	var id = new Buffer(params.id, 'base64').toString('utf8');
	var tResp, actions, gather;

	if (CACHE[id]) {
		//found entry in cache, build and respond with twiml
		//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
		gather = CACHE[id].gather;

		//check if the index provided in URL is that of a Gather verb
		if (gather.index === params.index) {
			//get the actions array based on the pressed ivr digit
			actions = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions');

			tResp = helpers.buildIvrTwiml(actions, params.id, params);

			return when.resolve(tResp);
		} else {
			//index is not that of a Gather verb so it must be of an action
			//find the requested index inside the nested array pulling out specifically the only action requested
			actions = _.find(_.result(_.find(gather.nested, {actions: [{index: params.index}]}), 'actions'), {index: params.index});
			
			if (actions) {
				tResp = helpers.buildIvrTwiml(actions, params.id, params);

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
		var tResp, actions, gather;

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
			} else {
				//return the action based on index id if Digits are not available (after the user already pressed a digit)
				actions = _.find(_.result(_.find(gather.nested, {actions: [{index: params.index}]}), 'actions'), {index: params.index});
				if (!actions) {
					actions = gather;
				}
			}
		} else {
			//this is a top level action
			actions = gather;
		}

		tResp = helpers.buildIvrTwiml(actions, params.id, params);

		return when.resolve(tResp);
	})
	.catch(function(err) {
		var msg, tResp;
		console.log('callActionResponse ERROR: ', err);
		msg = (err instanceof Error) ? err.message : err
		tResp = helpers.buildErrorTwiml(msg);
		return when.resolve(tResp);
		//return when.reject(new Error('VoiceCallResponse: Failed to get record from DB - '+err));
	});


	//TODO save a db record to track IVR interactions
}
*/

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
	return when.resolve(rTwiml.toString());
}

function _buildIvrTwiml(actions, userid, vars) {
	var rTwiml = TwimlResponse();
	var params = cleanUp(vars);

	if (!(actions instanceof Array)) actions = [actions];

	for (var i=0; i < actions.length; i++) {
		create(actions[i], rTwiml);
	}

	function create(item, twiml) {
		var tmpl = undefined;
		switch (item.verb) {
			case 'say':
				tmpl = _.template(item.nouns.text);
				twiml.say(tmpl(params), item.verb_attributes);
				break;
			case 'dial':
					item.verb_attributes.method = "POST"
					item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
					item.verb_attributes.action += '/' + item.index;
				twiml.dial(item.verb_attributes, function(node) {
					if ('number' in item.nouns) {
						for (var j=0; j < item.nouns.number.length; j++) {
							node.number(item.nouns.number[j]);	
						}
					} else node.text = item.nouns.text;
				});
				break;
			case 'hangup':
				twiml.hangup();
				break;
			case 'gather':
				console.log('ITEM: ', item)
				item.verb_attributes.method = "POST";
				item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
				item.verb_attributes.action += '/' + item.index;
				twiml.gather(item.verb_attributes, function(node) {
					if ('nested' in item && item.nested.length) {
						for (var j=0; j < item.nested.length; j++) {
							create(item.nested[j], node);
						}
					}
				});
				break;
			case 'pause':
				twiml.pause(item.verb_attributes);
				break;
			case 'reject':
				twiml.pause(item.verb_attributes);
				break;
			case 'message':
				item.verb_attributes.method = 'POST';
				item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
				item.verb_attributes.action += '/' + item.index;
				item.verb_attributes.statusCallback = config.callbacks.StatusCallback.replace('%userid', userid);
				tmpl = _.template(item.nouns.body);
				twiml.sms(tmpl(params), item.verb_attributes);
				break;
		}
	}

	function cleanUp(p) {
		var datetime = new Date();
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