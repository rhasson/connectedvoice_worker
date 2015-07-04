var restify = require('restify'),
	server = restify.createServer(),
	processor = require('./libs/processor'),
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

	function postHandlerAction(request, reply, next) {
		processor.put(processor.inbound, {
			request: request,
			reply: reply,
			next: next,
			route_type: 'action'
		});
	}

	server.listen(9000, function() {
		console.log('Started Voice API server - ' + new Date());
		
		csp.go(function*() {
			console.log('starting outbound taker')
			var val = yield csp.take(processor.outbound);
			while (val !== csp.CLOSED) {
				val.reply.setHeader('content-type', 'application/xml');
				if (val.body instanceof Error) val.reply.send(403, val.body.message);
				else if (val.body === undefined) val.reply.send(200);
				else val.reply.send(200, val.body);
				val.reply.end();
				val.next();
				val = yield csp.take(processor.outbound);
			}
		});
	});