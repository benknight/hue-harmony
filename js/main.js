// @requires d3
// @requires tinycolor
// @requires jsHue
// @requires Spinner
// @requires colors
// @requires ColorWheel
// TODO: Convert this to requirejs
(function () {
	'use strict';

	var msg = {
		CONNECTING: 'Connecting...',
		SUCCESS: 'Successfully connected to local bridge!',
		NO_BRIDGE: 'No bridge found on your local network.',
		PRESS_BUTTON: 'Please authenticate by pressing the button on the Hue bridge. Click to retry.',
		CONNECTION_ERROR_GENERIC: 'Unable to connect to the Internet.',
		CONNECTION_ERROR_BRIDGE: 'Unable to connect to local bridge.',
		UNAUTHORIZED_USER: 'Unauthorized user.'
	};

	// Add mode toggle UI
	ColorWheel.extend('modeToggle', function (colorWheel) {
		var modeToggle = d3.select('.scaffold__left').append('select')
			.attr('class', 'mode-toggle')
			.attr('size', 7)
			.on('change', function () {
				colorWheel.currentMode = this.value;
				colorWheel.setHarmony();
			});

		for (var mode in ColorWheel.modes) {
			modeToggle.append('option').text(ColorWheel.modes[mode])
				.attr('selected', function () {
					return ColorWheel.modes[mode] == colorWheel.currentMode ? 'selected' : null;
				});
		}
	});

	// Add switches
	ColorWheel.extend('switches', function (colorWheel) {
		var switchesParent = d3.select('.scaffold__right').append('div').attr('class', 'switches');
		colorWheel.dispatch.on('bindData.switches', function (data) {
			var switches = switchesParent.selectAll('.switch').data(data);
			var newSwitches = switches.enter().append('div').attr('class', 'switch');
			// append name
			newSwitches.append('b').text(function (d) { return d.name; });
			// append sliders
			newSwitches.append('paper-slider').attr('value', 50);
			switches.exit().remove();
		});
	});

	var app = {
		APP_ID: 'hue-colorwheel-app', // for registering with the API
		hue: jsHue(), // jsHue instance
		api: null, // jsHueUser instance
		wheel: null, // ColorWheel instance
		bridgeIP: null, // the bridge IP
		username: null, // the hue API username
		cache: {}, // for caching API data
		markerToLIDMap: [], // map bulbs to wheel markers
		colorWheelOptions: {
			container: '.scaffold__left',
			width: 500
		},
		$: {
			alert: $('#alert'),
			loading: $('#loading')
		},

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
						resolve();
					}
				},
				function (error) {
					reject(Error(error));
				});
			});
		},

		getAPIUser: function () {
			console.log('Getting API user...');
			var self = this;
			var storedUser = window.localStorage.getItem('username') || undefined;
			self.api = self.hue.bridge(self.bridgeIP).user(storedUser);
			if (storedUser) {
				return;
			} else {
				return self.createAPIUser();
			}
		},

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

		updateAction: function () {
			var self = this;
			self.wheel.container.selectAll('.wheel__marker').each(function (d, i) {
				var hex = tinycolor({h: d.h, s: d.s, v: d.v}).toHexString();
				self.api.setLightState(
					self.markerToLIDMap[i],
					{'xy': colors.hexToCIE1931(hex)},
					function (success) {
						// clear loading
					},
					function (failure) {
						// clear loading
						// report error
						console.error(failure);
					}
				);
			});
		},

		buildWheel: function () {
			var self = this;
			self.$.alert.addClass('alert--success').text(msg.SUCCESS).delay(3000).fadeOut();
			var lightKeys = (
				JSON.parse(window.localStorage.getItem('group'))
				|| Object.keys(self.cache.fullState.lights)
			);
			// Filter by "on"
			lightKeys = lightKeys.filter(function (lid) {
				return self.cache.fullState.lights[lid].state.on;
			});
			// Map wheel markers to lights.
			self.markerToLIDMap = lightKeys;
			var data = lightKeys.map(function (lid) {
				return {
					name: self.cache.fullState.lights[lid].name,
					colorString: colors.CIE1931ToHex.apply(null, self.cache.fullState.lights[lid].state.xy)
				}
			});
			self.wheel = new ColorWheel(self.colorWheelOptions);
			self.wheel.container.select('svg').attr('preserveAspectRatio', 'xMinYMin');
			self.wheel.dispatch.on('updateEnd.huePizza', self.updateAction.bind(self));
			self.wheel.bindData(data);
		},

		showError: function (e) {
			console.error(e.stack);
			this.$.alert.addClass('alert--error').text(e.message).show();
			if (e.message == msg.PRESS_BUTTON) {
				this.$.alert.addClass('alert--clickable').click(this.init.bind(this));
			}
		},

		init: function () {
			var self = this;
			self.$.alert.attr('class', 'alert').text(msg.CONNECTING).show();
			self.connectToLocalBridge()
				.then(self.getAPIUser.bind(self))
				.then(self.cacheFullState.bind(self))
				.then(self.buildWheel.bind(self))
				.catch(self.showError.bind(self));
		}
	};

	app.init();
	window.app = app;

})();