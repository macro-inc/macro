# Canvas multiplayer browser fixture

This fixture mounts three independent Canvas sessions (two editors and a viewer)
using the production Loro backend, session persistence contract, awareness adapter,
and graphics surface. An in-memory transport replaces hosted SyncService. It does
not mount the app shell or exercise hosted authentication.

From `apps/web`, run:

```sh
bunx playwright test --config src/features/block-canvas/browser-test/playwright.config.ts
```

The desktop case covers drag previews, cursors, remote selection and style,
local undo, session reopening, and peer departure. The touch case covers mobile
selection awareness. Each case runs only in its applicable device project.
`touch-navigation.browser.e2e.ts` sends real multi-touch through Chromium
(`Input.dispatchTouchEvent`) in the touch project: pinch in the select, hand,
rectangle and pencil tools after the first finger has started its gesture,
two-finger pan, and the glide after a flick. `window.canvasFixture.setTool`
switches the fixture's tool.

The config has four projects. `chromium` (desktop) and `mobile` (a Pixel 7)
run every spec but the two below. `tablet` runs `touch-tablet.browser.e2e.ts`
at an upright tablet's width: the one-row bar, the side inspector, a fit beside
it, and two fingers over CDP. `webkit`, the engine of Safari and the iOS app,
has no CDP and so runs `touch-taps.browser.e2e.ts`, what single taps can check:
the tools above the dock, selection by tap and near a stroke, the zoom sheet
and the Attach sheets. Sheet rows follow the system text size, which WebKit on
a desktop sets smaller than a phone does, so row heights are only asserted in
Chromium.

`embedded.html` puts the touch embed (`views/mobile/canvas-embedded-view.tsx`)
between the paragraphs of a page long enough to scroll.
`embedded.browser.e2e.ts` checks in the touch project that a swipe over the
canvas scrolls the document and leaves the camera alone, that two fingers zoom
and pan the canvas and leave the document alone, and that Interact gives one
finger to the canvas until Done or a press elsewhere.

`touch.html` mounts the editable canvas as a phone shows it: the real touch
view (`views/mobile/canvas-view.tsx`) and the real float-region host, over a
stand-in dock and a stand-in for the page's New button, with no session or
services. `touch.html?chrome=none` leaves the host out, as a public link opened
signed out does. `touch-layout.browser.e2e.ts` runs against it in the touch
project: the tools above the dock, uncovered and at least 44px; the grouped
tools; the selection's actions and their undo steps; the inspector sheet
resting under the shape and closing with the selection kept; the long-press
menu outliving the lift (and a drag not opening it), with Select inside group
for an item in a group; the zoom sheet, and its Keep tool after drawing
switch drawing several rectangles from one choice of the tool; the
in-canvas placement without the app's chrome; a corner taken from 12px outside
it and the shape moved from its middle; an outlined shape selected by a tap
near its stroke; the Attach sheet, whose Upload media row reaches the file
picker and hands over the chosen file after the sheet has closed; Zoom to fit
keeping the scene clear of the bottom chrome; a turn of the device keeping
the middle of the view; and a fill picked from the sheet's swatches with the
shape still in view. The long-press cases advance Playwright's clock rather than
waiting.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an installed Chromium.

The same spec checks that the lift of a long press presses no row of the menu
that opened under the finger. That takes the browser's own click, which
Chromium sends only for a finger that lifts within its tap time, so the test
turns the sheet's slide off and lifts at once. It also draws a connector and
checks that a tap beside its end leaves it as it was, and that a drag from
there moves the end. A pen is sent over CDP as a mouse of pointer type pen: one
test draws with it and checks that a finger under the same tool then pans, until
Draw with pen only is switched off in the zoom sheet.

![Two editors and a viewer sharing a scene and Alice's cursor](multiplayer.png)


The separate `render.playwright.config.ts` mounts the production read-only
`canvas-render.html` bundle and checks actual DOM text bounds after measured grow,
contain/error, relabeling, font changes and narrower widths, for rectangles,
ellipses, standalone text, unbroken strings and tiny glyph widths. It runs desktop
and phone projects. Set `CANVAS_RENDER_BASE_URL` to use a running preview instead
of starting fixture Vite. No live scene or account data is changed by these tests.
Check visible DOM word ranges and mention-chip rectangles against the intended
interior; container dimensions alone can hide overflowing words.
When other Docker stacks are changing host network interfaces, run Playwright in
the frontend container. Host Chromium can abort module loads with
`ERR_NETWORK_CHANGED`.


The live local-stack acceptance run used two named concurrent model writers, then
checked a native cropped image and actual DOM bounds after fitting at 24px.

![Live measured rectangle and ellipse labels at readable font sizes](text-fitting.png)
