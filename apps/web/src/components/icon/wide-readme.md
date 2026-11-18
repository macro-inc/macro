Note on the formatting of these wide icons.

1. The view box should be set to 0 n 24 24 where n = -1 * {the height of the svg} / 2. This is so that the svg is correctly centered in a square viewbox.
2. In the <svg> tag set fill to "currentColor" and width and height to "100%" and stroke set to "None". 
3. <path> tag should not have any fill or stroke set on it.

When exporting the SVGs we should export the inner-most container.

The `wide-priority-*` family instead shares the existing `0 0 18 12` viewBox.
Keep the same bar geometry and display box for None, Low, Medium, and High.
`wide-priority-none.svg` sets all three bars to 30% opacity in the file; render
it with the same color as the other wide priorities, without extra dimming.
