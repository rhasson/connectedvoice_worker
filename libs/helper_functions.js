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
				var tResp = helpers.buildIvrTwiml(doc.actions, params.id);
				return when.resolve(tResp.toString());
			})
			.catch(function(err) {
				return when.reject(new Error('VoiceCallResponse: Failed to get record from DB - '+err));
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
		return when.resolve();
	},
	buildIvrTwiml: function(actions, userid) {
		var rTwiml = TwimlResponse();
		
		actions.forEach(function(item) { create(item, rTwiml); });

		function create(item, twiml) {
			switch (item.verb) {
				case 'say':
					twiml.say(item.nouns.text, item.verb_attributes);
					break;
				case 'dial':
					if (!('action' in item.verb_attributes)) {
						item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
						item.verb_attributes.action += '/dial';
					}
					twiml.dial(item.verb_attributes, function(node) {
						if ('number' in item.nouns) {
							item.nouns.number.forEach(function(num) { node.number(num); });
						} else node.text = item.nouns.text;
					});
					break;
				case 'hangup':
					twiml.hangup();
					break;
				case 'gather':
					if (!('action' in item.verb_attributes)) {
						item.verb_attributes.action = config.callbacks.ActionUrl.replace('%userid', userid);
						item.verb_attributes.action += '/gather';
					}
					twiml.gather(item.verb_attributes, function(node) {
						if ('nested' in item && item.nested.length) {
							item.nested.forEach(function(child) {
								node = create(child, node);
							});
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
					twiml.message(item.nouns.body, item.verb_attributes);
					break;
			}
		}
		return rTwiml.toString();
	}
}