"use strict";
var jsonStream = require("duplex-json-stream");
var defer = require("promise-defer");
var EventEmitter = require("events");
var iterate = require("iterate-object");

module.exports = RPCP;

/**
 * Constructs a new RPCP instance
 * @param {Stream} stream        The stream to use for communication, must be duplex
 * @param {Object} localMethods  A map of local method names to functions that return promises
 * @param {Array}  remoteMethods A list of methods that are expected to exist on the remote end
 */
function RPCP(stream, localMethods, remoteMethods) {
	this._invocation = 0;
	this._calls = {};
	this._events = new EventEmitter();
	this._stream = jsonStream(stream);
	this._methods = {};
	this.methods = {};

	// Register remote/local methods if they were provided
	if (localMethods)
		this.registerLocalMethods(localMethods);
	if (remoteMethods)
		this.registerRemoteMethods(remoteMethods);

	this._stream.on("data", handleData.bind(null, this));
}

RPCP.prototype = {
	// "Private" properties
	_stream: null,
	_calls: null,
	_methods: null,
	_invocation: 0,

	// Public properties
	methods: null,

	// RPC invocation
	call: call,

	// RPC configration
	registerLocalMethod: registerLocalMethod,
	registerRemoteMethod: registerRemoteMethod,
	registerLocalMethods: registerLocalMethods,
	registerRemoteMethods: registerRemoteMethods,

	// Event stuff
	on: on,
	addListener: on,
	removeListener: removeListener,
	removeAllListeners: removeAllListeners,
	emit: emit
};

function handleData(rpcp, data) {
	var id = data.id;
	if (!id) return handleNotification(rpcp, data);
	if (data.result) handleResult(rpcp, data);
	if (data.error) handleError(rpcp, data);
	if (data.method) handleInvocation(rpcp, data);

	// Handle invalid data here? Ignore it?
}

function handleResult(rpcp, data) {
	var id = data.id;
	var result = data.result;
	var calls = rpcp._calls;
	var invocation = calls[id];

	// TODO: Handle this error better
	if (!invocation) return;

	invocation.resolve(result);

	delete calls[id];
}

function handleError(rpcp, data) {
	var id = data.id;
	var result = data.result;
	var calls = rpcp._calls;
	var invocation = calls[id];

	// TODO: Handle this error better
	if (!invocation) return;

	invocation.reject(result);

	delete calls[id];
}

function handleInvocation(rpcp, data) {
	var method = data.method;
	var id = data.id;
	var params = data.params;

	var fn = rpcp._methods[method];

	if (!fn) return rpcp._stream.write({
		jsonrpc: "2.0",
		error: {
			code: -32601,
			message: "Method " + method + " not found"
		},
		id: id
	});

	try {
		Promise.resolve(fn.call(undefined, params))
			.then(handleInvokeSuccess)
			.catch(handleInvokeError);
	} catch (e) {
		handleInvokeError(e);
	}

	function handleInvokeSuccess(result) {
		rpcp._stream.write({
			jsonrpc: "2.0",
			id: id,
			result: result
		});
	}

	function handleInvokeError(e) {
		var code = e.code || -32603;
		rpcp._stream.write({
			jsonrpc: "2.0",
			error: {
				code: code,
				message: e.message,
				data: e
			},
			id: id
		});
	}
}

function handleNotification(rpcp, data) {
	var method = data.method;
	var params = data.params;
	rpcp._events.emit(method, params);
}

function call(method, params) {
	var id = this._invocation++;
	var deferred = defer();
	this._calls[id] = deferred;

	this._stream.write({
		jsonrpc: "2.0",
		id: id,
		method: method,
		params: params
	});

	return deferred.promise;
}

function registerLocalMethod(method, fn) {
	this._methods[method] = fn;
	return this;
}

function registerLocalMethods(methods) {
	var rpcp = this;
	iterate(methods, function(fn, method) {
		rpcp.registerLocalMethod(method, fn);
	});
	return this;
}

function registerRemoteMethod(method) {
	this._methods[method] = call.bind(this, method);
	return this;
}

function registerRemoteMethods(methods) {
	methods.forEach(registerRemoteMethod, this);
	return this;
}

function on(event, cb) {
	return this._events.on(event, cb);
}

function removeListener(event, cb) {
	return this._events.removeListener(event, cb);
}

function removeAllListeners(event) {
	return this._events.removeAllListeners(event);
}

function emit(event, data) {
	this._stream.write({
		jsonrpc: "2.0",
		method: event,
		params: data
	});
}
