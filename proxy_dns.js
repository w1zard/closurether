'use strict';

var dgram = require("dgram"),
	server = dgram.createSocket("udp4");

var FLAG_RES = 0x8000,
	PUB_DNS = '8.8.8.8';

var domain_type = {},
	TYPE_WEB = 1,
	TYPE_SVC = 2;

var web_look_tid = {};



var qid_addr = [],
	ipBuf,
	bufAns = new Buffer([			//+16 bytes
		0xC0, 0x0C,					// domain ptr
		0x00, 0x01,					// type
		0x00, 0x01,					// class
		0x00, 0x00, 0x00, 0x0A,		// ttl
		0x00, 0x04,					// len
		0x00, 0x00, 0x00, 0x00,		// ip
	]);



function buildReply(buf, ipBuf) {
	var ret = new Buffer(buf.length + 16);
	ipBuf.copy(bufAns, +12);

	buf.copy(ret);					// response part
	bufAns.copy(ret, buf.length);	// answer part

	ret.writeUInt16BE(0x8180, +2);	// [02~03] flags
	ret.writeUInt16BE(0x0001, +6);	// [06~07] answer-couter
	return ret;
}


server.on("message", function(msg, remoteEndPoint) {
	var reqId = msg.readUInt16BE(+0);
	var reqFlag = msg.readUInt16BE(+2);

	//
	// 外网DNS服务器的答复，转给用户
	//
	if (reqFlag & FLAG_RES) {
		var ep = qid_addr[reqId];
		if (ep) {
			server.send(msg,
				0, msg.length,
				ep.port,
				ep.address
			);
			delete qid_addr[reqId];
		}
		return;
	}

	//
	// 获取域名字符串
	//
	var key = msg.toString('utf8', +12, msg.length - 5);
	var domain = key.replace(/[\u0000-\u0020]/g, '.').substr(1);

	var type = domain_type[domain];
	//
	// 已确定是非Web服务的域名：直接转交给外网DNS
	//
	if (type === TYPE_SVC) {
		qid_addr[reqId] = remoteEndPoint;

		server.send(msg,
			0, msg.length,
			53,
			PUB_DNS
		);
		return;
	}

	//
	// 未知类型域名：暂时先解析到本机，观察之后是否有Web请求
	//
	if (type === undefined) {
		var tid = web_look_tid[domain];
		if (tid > 0) {
			clearTimeout(tid);
		}

		web_look_tid[domain] = setTimeout(function() {
			delete  web_look_tid[domain];
			domain_type[domain] = TYPE_SVC;
			console.log('[DNS] addSvcDomain:', domain);
		}, 10 * 1000);
	}

	var packet = buildReply(msg, ipBuf);

	server.send(packet,
		0, packet.length,
		remoteEndPoint.port,
		remoteEndPoint.address
	);

	console.log('[DNS] %s\tQuery %s', remoteEndPoint.address, domain);
})


server.on("listening", function() {
	console.log("[DNS] running %s:%d",
		server.address().address,
		server.address().port
	);
})



exports.start = function() {
	server.bind(53);
}

exports.stop = function() {
	server.close();
}

exports.setPubDNS = function(ip) {
	PUB_DNS = ip;
}

exports.setLocalIP = function(ip) {
	ipBuf = new Buffer(ip.split('.'));
}

exports.addWebDomain = function(domain) {
	domain_type[domain] = TYPE_WEB;

	var tid = web_look_tid[domain];
	if (tid) {
		clearTimeout(tid);
	}
}