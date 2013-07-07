(function() {
	//
	// just cache
	//
	var arr = '$LIST'.split('|');

	function preload() {
		var url = arr.pop();
		if (url) {
			new Image().src = 'http://' + url;
			setTimeout(preload, 100);
		}
	}

	preload();

})()
