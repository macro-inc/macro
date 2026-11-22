# Wheel picker

`WheelPicker` draws one 220px wheel group and a shared selection band. Compose
`WheelColumn` children with controlled string values and localized labels. The
calendar month/year sheet and phone event clock use the same columns.

- Each column has five 44px rows and two empty rows at either bounded edge.
- Set `loop` for cyclical values; omit it for a bounded range.
- Native scrolling and CSS snapping own motion. Values commit after scrolling
  stops, never during a held touch. Safari's missing `scrollend` support is
  handled by a 150ms quiet period.
- Arrow keys change a value; Home and End select the first and last values.
  One focusable spinbutton per column announces the localized value.
- Controlled value/option changes, disablement, and disposal cancel pending work.
- Group and row geometry live in `wheel-values.ts` and `wheel-picker.css`.
  Color tokens map the design's accent/secondary/tertiary values to the app's
  `accent`, `ink-muted`, and `ink-subtle` tokens.

Wrap a standalone group in `SheetGroup` for the 4px inset and 24px outer radius.
Inside an existing `SheetGroup`, render the wheel directly to avoid a second fill.
`trailingLabel` reserves 64px for a live length/status label beside the selected row.

Check from `apps/web`: `bun run test src/components/app/mobile/wheel-picker`.
Native momentum, snap feel, VoiceOver/TalkBack, and safe-area layout need device
verification in addition to the unit tests.
