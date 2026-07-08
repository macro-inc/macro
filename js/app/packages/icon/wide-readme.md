Note on the formatting of these wide icons.

1. The view box should be set to 0 n 24 24 where n = -1 * {the height of the svg} / 2. This is so that the svg is correctly centered in a square viewbox.
2. In the <svg> tag set fill to "currentColor" and width and height to "100%" and stroke set to "None". 
3. <path> tag should not have any fill or stroke set on it.
4. For stroked icons, stroke-width should be 1/12 of the viewBox grid: 2 on a 24-unit grid, 1.5 on an 18-unit grid. Filled accents that read as line weight (list lines, dots) should be sized to match.

When exporting the SVGs we should export the inner-most container.
