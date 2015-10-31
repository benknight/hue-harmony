requirejs.config({
	paths: {
		'jquery': '//ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery',
		'd3': '../lib/d3/d3',
		'colorwheel': '../lib/kuler-d3/colorwheel',
		'tinycolor': '../lib/tinycolor/tinycolor',
		'hue-hacking': '../lib/hue-hacking/src/colors',
		'jshue': '../lib/jshue/src/jshue',
		'sortable': '../lib/Sortable/Sortable',
		'observe-js': '../lib/observe-js/src/observe',
		'lodash': '../lib/lodash/lodash'
	},
	shim: {
		'jshue': { exports: 'jsHue' }
	}
});

requirejs([
		'app',
		'gradient',
		'toggle',
		'theme',
		'observe-js',
		'lodash'
	], function (app) {
		app.init();
		window.app = app; // for debugging
	}
);
