var MIN_STABLE_DAY = 2,
	MIN_CACHE_DAY = 7,
	MAX_ITEM = 2,
	PATH_URL = 'url.txt',
	PATH_LIST = '../asset/list.txt';


var webpage = require('webpage'),
	fs = require('fs');

var site = [],
	site_res = {},
	used = {};


//
// load list
//
fs.read(PATH_URL).split('\n').forEach(function(line) {
	line = line.trim();
	if (!line || line.substr(0, 1) == '#') {
		return;
	}

	site.push(line);
});



function go(url) {
	var page = webpage.create(),
		result = site_res[url] || (site_res[url] = []);


	function ms2day(tick) {
		return ~~(tick / (24 * 3600 * 1000));
	}

	page.onResourceReceived = function(response) {
		if (response.url in used) {
			return;
		}
		used[response.url] = true;

		if (! /\.js$|\.js\?/i.test(response.url)) {
			return;
		}

		var last, now, exp;
		var sec;

		var i, headers = response.headers;
		for(i = headers.length - 1; i >= 0; --i) {
			var header = headers[i];

			switch(header.name.toLowerCase()) {
			case 'date':
				now = new Date(header.value);
				break;
			case 'expires':
				exp = new Date(header.value);
				break;
			case 'last-modified':
				last = new Date(header.value);
				break;
			}
		}

		if (!exp || !last) return;
		if (!now) now = new Date();

		var dayStable = ms2day(now - last);
		var dayCached = ms2day(exp - now);

		if (dayStable < MIN_STABLE_DAY || dayCached < MIN_CACHE_DAY) {
			return;
		}

		result.push({
			url: response.url,
			cache: dayCached,
			stable: dayStable
		});
	};


	function cb(status) {
		if (tid != -1) {
			clearTimeout(tid);
		}

		//
		// sort and display
		//
		if (result.length > 0) {
			result.sort(function(a, b){return a.stable - b.stable});

			if (result.length > MAX_ITEM) {
				result.length = MAX_ITEM;
			}

			console.log('==', url, '====================');
			for(var i = 0; i < result.length; i++) {
				var res = result[i];
				console.log(-res.stable + ' / +' + res.cache + '\t\t' + res.url);
			}
			console.log(' ');
		}

		//
		// breadth-first merge
		//
		if (++done == site.length) {
			var loop, merge = [];

			do {
				loop = false;

				for(var k in site_res) {
					var e = site_res[k].pop();
					if (e) {
						loop = true;
						merge.push( e.url.split('//')[1] );
					}
				}
			} while(loop);

			fs.write(PATH_LIST, merge.join('\n'));
			console.log('DONE!');
		}
	}

	var tid = setTimeout(function() {
		page.close();
		tid = -1;
		cb();
	}, 60 * 1000);

	page.open('http://' + url, cb);
}

var done = 0;

function start() {
	for(var i = 0; i < site.length; i++) {
		setTimeout(function(url) {
			go(url);
		}, 2000 * i, site[i]);
	}
}

start();