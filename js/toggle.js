define(['d3', 'colorwheel'], function (d3, ColorWheel) {
	// Add mode toggle UI to the ColorWheel
	ColorWheel.extend('modeToggle', function (colorWheel) {
		var modeToggle = d3.select('.scaffold__left').append('div').attr('class', 'mode-toggler');

		for (var mode in ColorWheel.modes) {
			var label = modeToggle.append('label');
			label.append('input')
					.attr({
						'type': 'radio',
						'name': 'modeToggle',
						'value': ColorWheel.modes[mode]
					})
					.on('change', function () {
						colorWheel.setMode(this.value);
					});
			label.append('span').text(ColorWheel.modes[mode]);
		}
		colorWheel.dispatch.on('setMode.modeToggle', function () {
			modeToggle.selectAll('input').property('checked', function () {
				return this.value == colorWheel.currentMode;
			});
		});
	});
});