# Canvas

## Canvas colors

To check the default canvas color, create a rectangle and a text box without
changing the swatch. The rectangle should have a light neutral fill and a dark
outline; the text should be dark and visible. Also check the neutral swatch after
selecting another color. Neutral colors use an OKLCH `none` hue, which must render
as gray rather than transparent.

## Canvas link paste

Pasting a supported routed Macro app link onto the canvas creates a text
node with an entity mention, as legacy links do. Routed links retain compatible
block targets, but not workspace paths or pane-local search state; unsupported
links remain text.
