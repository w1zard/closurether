'use strict';

var proxyDns = require('./proxy_dns.js'),
	proxyWeb = require('./proxy_web.js'),
	os = require('os');


function GetLocalIP() {
	var nifs = os.networkInterfaces();

	for(var i in nifs) {
		var adapters = nifs[i];

		for(var j in adapters) {
			var cfg = adapters[j];
			if (cfg.family !== 'IPv4')
				continue;

			if (! /^(0|127|169.254)/.test(cfg.address))
				return cfg.address;
		}
	}
}

function main() {
	var localIP = GetLocalIP();
	if (!localIP) {
		console.log('[SYS] can not get local ip!');	
		return;
	}

	console.log('[SYS] local ip: ' + localIP);

	proxyDns.setLocalIP(localIP);
	proxyDns.start();

	proxyWeb.addPort(80);
}

main();