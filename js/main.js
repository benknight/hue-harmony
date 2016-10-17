requirejs.config({
	paths: {
		'jquery': '//ajax.googleapis.com/ajax/libs/jquery/2.1.3/jquery',
		'd3': '../bower_components/d3/d3',
		'colorwheel': './colorwheel/colorwheel',
		'tinycolor': '../bower_components/tinycolor/tinycolor',
		'hue-hacking': '../bower_components/hue-hacking/src/colors',
		'jshue': '../bower_components/jshue/src/jshue',
		'sortable': '../bower_components/Sortable/Sortable',
		'observe-js': '../bower_components/observe-js/src/observe',
		'lodash': '../bower_components/lodash/lodash'
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
