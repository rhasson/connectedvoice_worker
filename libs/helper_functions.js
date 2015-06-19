var _ = require('lodash'),
	config = require('../config.json'),
	when = require('when'),
	whennode = require('when/node'),
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

module.exports = helpers = {
	voiceCallResponse: function(params) {
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
				var tResp = helpers.buildIvrTwiml(doc.actions, params.id, params);
				return when.resolve(tResp);
			})
			.catch(function(err) {
				var msg, tResp;
				console.log('voiceCallResponse ERROR: ', err);
				msg = (err instanceof Error) ? err.message : err
				tResp = helpers.buildErrorTwiml(msg);
				return when.resolve(tResp);
				//return when.reject(new Error('VoiceCallResponse: Failed to get record from DB - '+err));
			});
		}
	},
	callStatusResponse: function(params) {
		console.log('STATUS REQUEST: PARAMS: ', params);
		//todo: create a new call status event record and store params
		var id = new Buffer(params.id, 'base64').toString('utf8');
		
		params.id = id;
		params.type = 'call_status';

		return dbinsert(params).then(function(doc) {
			var body = doc.shift();
			if (!('ok' in body) || !body.ok) {
				console.log(body);
				return when.reject(new Error('Failed to save call status record to DB'));
			} else {
				return when.resolve(body);
			}
		});
	},
	callActionResponse: function(params) {
		console.log('ACTION REQUEST: PARAMS: ', params);
		var id = new Buffer(params.id, 'base64').toString('utf8');
		var tResp, actions, gather;

		if (CACHE[id]) {
			//found entry in cache, build and respond with twiml
			//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
			gather = CACHE[id].gather;

			if (gather.index === params.index) {
				//get the actions array based on the pressed ivr digit
				actions = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions');

				tResp = helpers.buildIvrTwiml(actions, params.id, params);

				return when.resolve(tResp);
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

			//get the gather verb that is responsible for the ivr with the index # provided by the API call from twilio
			gather = _.find(doc.actions, 'index', params.index);
			//cache it for future API calls
			CACHE[id].gather = gather;
			//get the actions array based on the pressed ivr digit
			actions = _.result(_.find(gather.nested, {nouns: {expected_digit: params.Digits}}), 'actions');

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


/*
		params.id = id;
		params.type = 'action_status';
		


		//TODO save a db record to track IVR interactions
		return dbinsert(params).then(function(doc) {
			var body = doc.shift();
			if (!('ok' in body) || !body.ok) {
				console.log('Failed to save call action record to DB: ', body);
			}

		});		
*/		
	},
	buildErrorTwiml: function(message) {
		var rTwiml = TwimlResponse();
		rTwiml.say(message, {
			voice: 'Woman',
			loop: 1,
			language: 'en'
		});
		rTwiml.hangup();
		return rTwiml.toString();
	},
	buildIvrTwiml: function(actions, userid, params) {
		var rTwiml = TwimlResponse();
		var params = cleanUp(params);

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
					if (!('action' in item.verb_attributes)) {
						item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
						item.verb_attributes.action += '/dial';
					}
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
					if (!('action' in item.verb_attributes)) {
						item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid) + '/' + item.index;
						item.verb_attributes.action += '/gather';
					}
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
					if (!('action' in item.verb_attributes)) {
						item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
						item.verb_attributes.action += '/message';
					}
					if (!('statusCallback' in item.verb_attributes)) item.verb_attributes.statusCallback = config.callbacks.StatusCallback.replace('%userid', userid);
					tmpl = _.template(item.nouns.body);
					twiml.message(tmpl(params), item.verb_attributes);
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
}