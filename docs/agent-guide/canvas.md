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

## Copying and saving images

Select exactly one image to show **Copy image** and **Save image** in both the
context menu and the Canvas inspector. They use the original image, without
canvas transforms or styling. Copy writes image data where supported; the shared
image action can fall back to copying its URL. Save downloads the source format
on desktop and uses the native share sheet on supported mobile devices.
Controls are disabled while resolving the image source or running an action.
Check an uploaded image and a workspace image, and confirm both actions disappear
for multiple selections, groups, videos, and non-image shapes.
