/* DB abstraction */

var config = require('../config.json'),
	when = require('when'),
	whennode = require('when/node'),
	cloudant = require('cloudant')({
		account: config.cloudant.production.account,
		key: config.cloudant.production.key,
		password: config.cloudant.production.password
	}),
	db = cloudant.use(config.cloudant.production.db_name);

module.exports = {
	insert: whennode.lift(db.insert),
	search: whennode.lift(db.search),
	get: whennode.lift(db.get),
	remove: whennode.lift(db.destroy)
}