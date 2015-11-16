define(['d3', 'colorwheel'], function (d3, ColorWheel) {

	// Add mode toggle UI to the ColorWheel
	ColorWheel.extend('modeToggle', function (wheel) {
		var container = document.createElement('paper-material');
		Polymer.dom(container).setAttribute('elevation', 2);
		var modeToggle = document.createElement('paper-radio-group');

		// Don't use Monochrome
		delete ColorWheel.modes.SHADES;

		for (var mode in ColorWheel.modes) {
			var modeToggleOption = document.createElement('paper-radio-button');
			Polymer.dom(modeToggleOption).setAttribute('name', ColorWheel.modes[mode]);
			Polymer.dom(modeToggleOption).textContent = ColorWheel.modes[mode];
			modeToggleOption.addEventListener('change', function () {
				wheel.setMode(this.getAttribute('name'));
			});
			Polymer.dom(modeToggle).appendChild(modeToggleOption);
		}

		container.appendChild(modeToggle);
		document.querySelector('#page-1').appendChild(container);

		wheel.dispatch.on('modeChanged.modeToggle', function () {
			Polymer.dom(modeToggle).setAttribute('selected', wheel.currentMode);
		});
	});
});
