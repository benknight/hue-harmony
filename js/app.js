define(function (require) {
	'use strict';

	var $ = require('jquery');
	var d3 = require('d3');
	var tinycolor = require('tinycolor');
	var jsHue = require('jshue');
	var colors = require('hue-hacking');
	var ColorWheel = require('colorwheel');

	// Collection of strings the app may need to show the user
	var msg = {
		CONNECTING: 'Connecting...',
		SUCCESS: 'Successfully connected to local bridge!',
		NO_BRIDGE: 'No bridge found on your local network.',
		PRESS_BUTTON: 'Please authenticate by pressing the button on the Hue bridge. Click to retry.',
		CONNECTION_ERROR_GENERIC: 'Unable to connect to the Internet.',
		CONNECTION_ERROR_BRIDGE: 'Unable to connect to local bridge.',
		UNAUTHORIZED_USER: 'Unauthorized user.'
	};

	var app = {
		APP_ID: 'hue-colorwheel-app', // for registering with the API
		hue: jsHue(), // jsHue instance
		api: null, // jsHueUser instance
		wheel: null, // ColorWheel instance
		bridgeIP: null, // the bridge IP
		username: null, // the hue API username
		cache: {}, // for caching API data

		colorWheelOptions: { // options for the ColorWheel instance
			container: '.scaffold__left',
			markerWidth: 35
		},

		$: { // references to DOM nodes
			alert: $('#alert'),
			loading: $('#loading'),
			controls: $('#controls')
		},

		// Cache the full Hue Bridge state
		cacheFullState: function () {
			console.log('Caching API fullState...');
			var self = this;
			return new Promise(function (resolve, reject) {
				self.api.getFullState(function (data) {
					if (data.length && data[0].error) {
						if (data[0].error.type == 1) {
							self.createAPIUser().then(resolve, reject);
						} else {
							reject(Error('"' + data[0].error.description + '" (error type ' + data[0].error.type + ')'));
						}
					} else {
						self.cache.fullState = data;
						this.observeChanges();
						resolve();
					}
				},
				function (error) {
					reject(Error(error));
				});
			});
		},

		observeChanges: function () {
			$.each(self.cache.fullState.lights, function (lid, light) {
				// TODO: Can't use O.o yet
				// Use this: https://github.com/polymer/observe-js
				Object.observe(light.state, function (changes) {
					changes.forEach(function (change) {
						if (change.type == 'update') {
							if (JSON.stringify(light.state[change.name]) !== JSON.stringify(change.oldValue)) {
								var update = {};
								update[change.name] = light.state[change.name];
								self.api.setLightState(lid, update);
							}
						}
					});
				});
			});
		},

		getLIDToMarkerMap: function () {
			var lidToMarkerMap = [];
			var lids = Object.keys(this.cache.fullState.lights);
			$('.theme__swatch').each(function (index) {
				lidToMarkerMap[lids[index]] = $(this).attr('data-marker-id');
			});
			return lidToMarkerMap;
		},

		// See if there is already a saved username, if not create one
		getAPIUser: function () {
			console.log('Getting API user...');
			var storedUser = window.localStorage.getItem('username') || undefined;
			this.api = this.hue.bridge(this.bridgeIP).user(storedUser);
			return storedUser || this.createAPIUser();
		},

		// Creates a new API user, only succeeds if the Bridge's button has been pressed
		createAPIUser: function () {
			console.log('Creating a new API user...');
			var self = this;
			return new Promise(function (resolve, reject) {
				self.api.create(
					self.APP_ID,
					function (data) {
						if (data[0].success) {
							window.localStorage.setItem('username', self.username);
							resolve();
						} else {
							if (data[0].error.type === 101) {
								reject(Error(msg.PRESS_BUTTON));
							} else {
								reject(Error(data[0].error.description));
							}
						}
					},
					function () { // ajax error
						reject(Error(msg.CONNECTION_ERROR_BRIDGE));
					}
				);
			});
		},

		// Hunt for the local Hue Bridge
		connectToLocalBridge: function () {
			console.log('Connecting to local brdige...');
			var self = this;
			return new Promise(function (resolve, reject) {
				self.hue.discover(
					function (bridges) {
						if (bridges.length === 0) {
							reject(Error(msg.NO_BRIDGE));
						} else {
							self.bridgeIP = bridges[0].internalipaddress;
							resolve();
						}
					},
					function (error) {
						reject(Error(msg.CONNECTION_ERROR_GENERIC));
					}
				);
			});
		},

		// Updates light states after wheel user interaction
		wheelUpdateAction: function () {
			var self = this;
			for (var lid in this.cache.fullState.lights) {
				var light = this.cache.fullState.lights[lid];
				if (light.state.on) {
					var markerIndex = self.getLIDToMarkerMap()[lid];
					var d = d3.select(self.wheel.getMarkers()[0][markerIndex]).datum();
					var hex = tinycolor({h: d.color.h, s: d.color.s, v: d.color.v}).toHexString();
					light.state.xy = colors.hexToCIE1931(hex);
				}
			}
		},

		// Renders the ColorWheel when everything's ready
		renderWheel: function () {
			var self = this;
			var wheelData = [];
			for (var lid in this.cache.fullState.lights) {
				var light = this.cache.fullState.lights[lid];
				wheelData.push(ColorWheel.createMarker(
					colors.CIE1931ToHex.apply(null, this.cache.fullState.lights[lid].state.xy),
					null,
					this.cache.fullState.lights[lid].state.on
				));
			}
			this.wheel = new ColorWheel(this.colorWheelOptions);
			this.wheel.bindData(wheelData);
			this.wheel.dispatch.on('updateEnd.pizza', this.wheelUpdateAction.bind(this));
		},

		// Renders the light switches and attached behavior
		renderSwitches: function () {
			var self = this;
			var $switches = $('<table>').addClass('switches');
			$.each(this.cache.fullState.lights, function (lid, light) {
				var $row = $('<tr>');
				// Add name
				$row.append( $('<td>').append( $('<b>').text(light.name) ));

				// Add brightness slider
				var $slider = $('<paper-slider>').attr({
						'class': 'switch__slider',
						'min': 0,
						'max': 255,
						'value': light.state.bri,
						'disabled': ! light.state.on,
					})
					.on('change', function () {
						light.state.bri = this.value;
					});
				$row.append( $('<td>').append($slider) );

				// Add on/off switch
				$row.append( $('<td>').append( $('<paper-toggle-button>').attr({
						'class': 'switch__toggle',
						'checked': !! light.state.on,
						'data-lid': lid
					})
					.on('change', function () {
						var markerIndex = self.getLIDToMarkerMap()[lid];
						var marker = d3.select(self.wheel.getMarkers()[0][markerIndex]);
						marker.datum().show = this.checked;
						$slider.attr('disabled', ! this.checked);
						light.state.on = this.checked;
						self.wheel.dispatch.updateMarkers();
						self.wheel.setMode(ColorWheel.modes.CUSTOM);
					})
				));
				$switches.append($row);
			});
			this.$.controls.append($switches);
		},

		// Builds the UI once the Hue API has been loaded
		render: function () {
			this.$.alert.addClass('alert--success').text(msg.SUCCESS).delay(3000).fadeOut();
			this.renderWheel();
			this.renderSwitches();
		},

		// Displays an error to the user, expecting an Error instance
		showError: function (e) {
			console.error(e.stack);
			this.$.alert.addClass('alert--error').text(e.message).show();
			if (e.message == msg.PRESS_BUTTON) {
				this.$.alert.addClass('alert--clickable').click(this.init.bind(this));
			}
		},

		// Start the app!
		init: function () {
			var self = this;
			self.$.alert.attr('class', 'alert').text(msg.CONNECTING).show();
			self.connectToLocalBridge()
				.then(self.getAPIUser.bind(self))
				.then(self.cacheFullState.bind(self))
				.then(self.render.bind(self))
				.catch(self.showError.bind(self));
		},

		// Start the app in demo mode, using mock data.
		demo: function () {
			var self = this;
			$.get('/demo/data.json', function (data) {
				self.cache.fullState = data;
				self.render();
			});
		}
	};

	return app;
});