# Macro interface icons

Original SVG drawings for Macro's interface. The source of truth is the SVG
files in this directory. These drawings were authored on a blank coordinate
grid; no Apple, OpenAI, Linear, or Phosphor vector paths were imported or traced.
SF Symbols and ChatGPT were visual references for optical balance and clarity,
not asset sources. The icons have no platform font or native symbol dependency.

Apple's design guidance informs optical balance, not asset reuse. Do not import,
trace, or modify SF Symbols exports or templates for this cross-platform set.
The original source geometry and this provenance note are not a legal clearance
or a guarantee of non-infringement. Apple's supplied images have separate
[platform-restricted terms](https://www.apple.com/legal/sla/docs/xcode.pdf).

## Drawing system

- A `0 0 24 24` viewBox. Most pictograms occupy an 18–19 unit optical area;
  round and diagonal forms can overshoot it to appear equally large.
- Regular strokes are 2 units: approximately 1.67 CSS px at a 20 px navigation
  size and 1.33 CSS px at a 16 px toolbar size. Internal details can use
  lighter strokes to preserve their negative space. Bold entity glyphs use 2.3 units.
- In the app, `icon-styles.css` optically adjusts those default strokes to
  1.7 / 2 units in light themes. Dark themes retain 2 / 2.3. At 20 px, the
  light regular stroke is about 1.42 px. Colors and filled silhouettes stay
  unchanged. Theme-scoped variables also support the gallery's nested themes.
- Rounded joins and terminals, restrained 2–3 unit corner radii, open counters,
  and few internal details. Macro's diagonal rhythm appears in folds, tails,
  branches, and the angular four-point agent mark.
- Active navigation variants keep their regular counterpart's optical center
  and silhouette. Cutouts are transparent, never theme-colored.
- `currentColor` owns both stroke and fill. Do not apply `fill-current` to an
  outline glyph or reuse stroke overrides designed for a 256-unit viewBox.

## Use

Import individual SVGs so unrelated drawings stay out of the startup bundle:

```tsx
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';

<button aria-label="Search"><SearchIcon class="size-4" /></button>
```

Use 20 px for rail navigation, 16 px for header actions and status glyphs,
and 14 px for compact secondary controls. Keep the enclosing hit target
independent of the drawing size. Avoid scaling detailed glyphs below 14 px.
SVGs are decorative by default; put accessible names on their controls.

The existing semantic filenames make the migration explicit at each import.
Several equivalent concepts (for example `folder` and `folder-simple`) share
the same drawing to avoid introducing competing silhouettes. Existing brand
logos and the legacy animated showcase retain their own assets and licensing.
Interface controls, including editor tools, file types, task states, priorities,
and settings, use this family; the remaining Phosphor imports are brand marks.

Prefer one recognizable silhouette and only the detail needed to identify its
action. Chat variants share one bubble, task variants one checked square,
people variants two figures. The CRM icon retains its stepped building silhouette. Calendar dots,
extra signal arcs, repeated windows, and decorative tool details are omitted.
Keep meaningful distinctions such as mute slashes, warning marks, file-type
symbols, and ordered-list numbers. The shared `../share.svg` also appears in the
gallery and follows the same theme-aware stroke rules.
File-type marks use 1.5-unit interior strokes in both weights to keep their
small counters open; the surrounding page retains the normal family weight.
Settings navigation and its page controls use this same set, including the
appearance, keyboard, usage, billing, runtime, integration, and developer icons.
Inactive settings rows use muted ink; selection and hover supply emphasis.

## Optical review principles

Apple's [interface icon guidance](https://developer.apple.com/design/human-interface-guidelines/icons)
informs the review: match the perceived weight of adjacent text, simplify detail,
and adjust each glyph's dimensions and padding for optical balance. The 24-unit
grid and stroke values above are Macro's drawing choices, not Apple requirements.
Center the visible shape, not only its bounding box; inspect its baseline and cap
height relationship when it sits beside a label.

Use outlines for ordinary toolbar and list actions. A filled counterpart can
emphasize selection, but it should preserve the original shape's visual position.
Review both variants at their actual size and contrast, following Apple's
[SF Symbols guidance](https://developer.apple.com/design/human-interface-guidelines/sf-symbols#Design-variants).
These are composition principles; the drawings remain independently authored.

## Interaction motion

`icon-motion.ts` is installed once by the app shell. It delegates pointer presses
and keyboard/assistive-technology clicks to the leading action glyph in buttons,
links, tabs, command options, and menu items, including portal menus and newly mounted controls.
All existing and newly authored `data-macro-icon` SVGs inherit this behavior.

- Keep feedback brief and finite: 320 ms on press, 280 ms on hover. Use a small
  press-and-settle, a restrained turn for settings, tilt for folders/mail,
  or lift for sharing. Do not bounce continuously or delay the action.
- Hover is limited to search, settings, add, and agent glyphs after 160 ms of
  pointer intent. Touch does not trigger hover. Most icons respond only to press.
- Animate the drawing, never its label, hit target, selection background, or
  layout. Individual transform properties preserve existing layout transforms.
- Put `data-icon-motion-target` on a fixed-size wrapper when an action swaps SVGs
  (as `NavGlyph` does). Both variants then move as one without a position jump.
- Static glyphs, disclosure arrows, state/check indicators, loading spinners,
  disabled/busy controls, and illustrations larger than 32 px stay still.
  Add `data-icon-motion="none"` on a glyph or ancestor for other stateful icons
  or controls that own their own motion. Do not add decorative motion to status.
- Respect `prefers-reduced-motion` for every effect, including hover; preference
  changes cancel in-flight animation. Rapid presses replace rather than stack.
- New semantic motion belongs in this shared module, not individual consumers.
  Draw original paths and motion; references such as Grok inform restraint and
  timing, never asset reuse. No new animation runtime is needed.

## Review

Open `/app/debug/icon-gallery` in the running app. The original family is the
default view; the legacy animated gallery remains available. Review the actual
14/16/20/24 px drawings on both Macro themes, then check the affected app view.
Do not judge a toolbar icon solely from a large preview. Use the weight tabs
and navigation buttons to check emphasis without a size or position jump.

After changing geometry, update its bold/active counterparts and inspect them
together. Test the real app on a standard-density display as well as Retina;
SVG portability alone does not verify Windows rendering.
