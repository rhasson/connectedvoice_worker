var restify = require('restify'),
	server = restify.createServer(),
	processor = require('./lib/processor'),
	csp = require('js-csp');
	//handlers = require('./libs/route_handlers');

	server.use(restify.queryParser());
	server.use(restify.gzipResponse());
	server.use(restify.bodyParser());
	
	server.use(function(req, repl, next) {
		console.log(req.headers, req.url);
		return next();
	});

	server.post('/actions/v0/:id/voice.xml', postHandlerVoice);
	server.post('/actions/v0/:id/status', postHandlerStatus);
	server.post('/actions/v0/:id/action', postHandlerAction);
	server.post('/actions/v0/:id/action/:index', postHandlerAction);

	function postHandlerVoice(request, reply, next) {
		processor.put(processor.inbound, {
			request: request,
			reply: reply,
			next: next,
			route_type: 'call'
		});
	}

	function postHandlerStatus(request, reply, next) {
		processor.put(processor.inbound, {
			request: request,
			reply: reply,
			next: next,
			route_type: 'status'
		});
	}

	function postHandlerVoice(request, reply, next) {
		processor.put(processor.inbound, {
			request: request,
			reply: reply,
			next: next,
			route_type: 'action'
		});
	}

	csp.go(function*() {
		var val = yield csp.take(processor.outbound);
		while (val !== csp.CLOSED) {
			val.reply.setHeader('content-type', 'application/xml');
			val.reply.end(val.body || 200);
			val.next();
			val = yield csp.take(processor.outbound);
		}
	});

/*
	server.post('/actions/v0/:id/voice.xml', handlers.v0.voiceCallHandler);
	server.post('/actions/v0/:id/status', handlers.v0.callStatusHandler);
	server.post('/actions/v0/:id/action', handlers.v0.callActionHandler);
	server.post('/actions/v0/:id/action/:index', handlers.v0.callActionHandler);
*/
	server.listen(9000, function() {
		console.log('Started Voice API server - ' + new Date());
	});