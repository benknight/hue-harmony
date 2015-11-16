define(['d3', 'colorwheel'], function (d3, ColorWheel) {
	// TODO: Do native DOM manipulation (or jQuery)
	// Only use d3 for SVG stuff.
	// Background gradient
	ColorWheel.extend('bgGradient', function (colorWheel) {
		var gradient = d3.select('.Gradient');
		if (! gradient.size()) {
			gradient = colorWheel.container.append('div').attr({
				'id': 'gradient',
				'class': 'Gradient'
			});
		}
		colorWheel.dispatch.on('updateEnd.gradient', function () {
			// Reset values
			gradient.style('background-image', null);
			gradient.style('background-color', null);
			var gradientStops = colorWheel.getColorsAsHEX();
			if (gradientStops.length === 1) {
				gradient.style('background-color', gradientStops[0]);
				gradient.style('background-image', 'none');
			} else if (gradientStops.length > 1) {
				gradientStops[0] += ' 10%';
				gradientStops[gradientStops.length - 1] += ' 90%';
				gradient.style('background-image', 'linear-gradient(to right, ' + gradientStops.join() + ')');
			}
		});
	});
});
