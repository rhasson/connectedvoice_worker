var restify = require('restify'),
	server = restify.createServer(),
	handlers = require('./libs/route_handlers');

	server.use(restify.queryParser());
	server.use(restify.gzipResponse());
	server.use(restify.bodyParser());

	server.post('/actions/v0/:id/voice.xml', handlers.v0.voiceCallHandler);
	server.post('/actions/v0/:id/status', handlers.v0.callStatusHandler);
	server.post('/actions/v0/:id/action', handlers.v0.callActionHandler);
	server.post('/actions/v0/:id/action/:index', handlers.v0.callActionHandler);

	server.listen(9000, function() {
		console.log('Started Voice API server - ' + new Date());
	});