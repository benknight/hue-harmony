// @requires d3
// @requires tinycolor
// @requires jsHue
// @requires Spinner
// @requires colors
// @requires ColorWheel
// TODO: Use an actual module loader.
(function () {
	'use strict';

	ColorWheel.plugins.theme = false;

	var msg = {
		CONNECTING: 'Connecting...',
		SUCCESS: 'Successfully connected to local bridge!',
		NO_BRIDGE: 'No bridge found on your local network.',
		PRESS_BUTTON: 'Please authenticate by pressing the button on the Hue bridge. Click to retry.',
		CONNECTION_ERROR_GENERIC: 'Unable to connect to the Internet.',
		CONNECTION_ERROR_BRIDGE: 'Unable to connect to local bridge.',
	};

	var app = {
		APP_ID: 'hue-colorwheel-app', // for registering with the API
		hue: jsHue(), // jsHue instance
		api: null, // jsHueUser instance
		wheel: null, // ColorWheel instance
		bridgeIP: null, // the bridge IP
		username: null, // the hue API username
		cache: {}, // for caching API data
		markerToLIDMap: [], // map bulbs to wheel markers

		// spin.js
		spinner: new Spinner({
			lines: 17, length: 0, width: 9, radius: 60, corners: 1, rotate: 0,
			direction: 1, color: '#fff', speed: 1, trail: 100, shadow: false,
			hwaccel: true, className: 'spinner', zIndex: 2e9, top: '50%', left: '50%'
		}).spin(document.body),

		// DOM nodes
		$: {
			alert: $('#alert'),
			loading: $('#loading')
		},

		connectToLocalBridge: function () {
			var self = this;
			self.$.alert.attr('class', '').text(msg.CONNECTING).show();

			return new Promise(function (resolve, reject) {

				var _cacheFullState = function () {
					self.api.getFullState(function (data) {
						self.cache['fullState'] = data;
						resolve();
					}, function (error) {
						reject(msg.CONNECTION_ERROR_BRIDGE);
					});
				};

				var _createAPIUser = function () {
					self.api.create(
						self.APP_ID,
						function (data) { // ajax success
							// api error
							if (data[0].success) {
								self.username = data[0].success.username;
								window.localStorage.setItem('username', self.username);
								_cacheFullState();
							} else {
								if (data[0].error.type === 101) {
									reject(msg.PRESS_BUTTON);
								} else {
									reject(data[0].error.description);
								}
							}
						},
						function () { // ajax error
							reject(msg.CONNECTION_ERROR_BRIDGE);
						}
					);
				};

				self.hue.discover(
					function (bridges) {
						if (bridges.length === 0) {
							reject(msg.NO_BRIDGE);
						} else {
							self.bridgeIP = bridges[0].internalipaddress;
							self.username = window.localStorage.getItem('username') || undefined;
							self.api = self.hue.bridge(self.bridgeIP).user(self.username);
							if (self.username) {
								_cacheFullState();
							} else {
								_createAPIUser();
							}
						}
					},
					function (error) {
						reject(msg.CONNECTION_ERROR_GENERIC);
					}
				);
			});
		},

		init: function () {
			var self = this;
			self.connectToLocalBridge().then(
				function () {
					// If we got this far, we have cached the full state of the Hue system!
					self.$.alert.attr('class', 'success').text(msg.SUCCESS).delay(1000).fadeOut();
					self.spinner.stop();

					// Map wheel markers to lights.
					for (var lid in self.cache.fullState.lights) {
						self.markerToLIDMap[lid - 1] = lid;
					}

					var data = Object.keys(self.cache.fullState.lights).map(function (lid) {
						return {
							name: self.cache.fullState.lights[lid].name,
							colorString: colors.CIE1931ToHex.apply(null, self.cache.fullState.lights[lid].state.xy)
						};
					});

					self.wheel = new ColorWheel(data, '#colorwheel', {margin: 80, width: 400});

					// Hook up listeners to wheel update event to handle changes.
					self.wheel.dispatch.on('updateEnd.hueWheelMain', function () {
						self.wheel.container.selectAll('.marker').each(function (d, i) {
							var hex = tinycolor({h: d.h, s: d.s, v: d.v}).toHexString();
							self.api.setLightState(self.markerToLIDMap[i], {'xy': colors.hexToCIE1931(hex)});
						});
					});
				},
				function (message) {
					console.log(message);
					self.$.alert.attr('class', 'error').text(message).show();
					if (message == msg.PRESS_BUTTON) {
						self.$.alert.addClass('clickable').click(self.init.bind(self));
					}
				}
			);
		}
	};

	app.init();
	window.app = app;

})(window.colors);