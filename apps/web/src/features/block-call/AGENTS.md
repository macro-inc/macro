# Saved call detail

## What it is

Saved call recordings, transcripts, summary Markdown and read-only discussion.
The live call UI belongs to `features/channel/Call`, not this feature.

## Start here

- `views/CallDetailView.tsx`: native route hosts, query, header and loading states.
- `component/CallRecording/CallRecordingBody.tsx`: one playback owner and responsive composition.
- `component/CallRecording/CallRecordingRoot.tsx`: shared recording and independent details state.
- `component/CallTranscript.tsx`: transcript rows, inline chat and follow/seek behavior.
- `component/sidepanel/CallSidePanelSections.tsx`: existing metadata, sharing and entity sections.
- `primitives/recording-playback.ts`: native media state and actions.
- `core/recording-chat.ts`: visible messages and valid recording offsets.

## Boundaries

- Read records through `useCallRecordQuery`; keep storage and SDK contracts unchanged.
- Read discussion through `CallDiscussionHistory`'s source slot; preserve channel authorization and canonical call-chat roots.
- Fullscreen the recording workspace to retain its video and transcript; scope the panel toggle to that fullscreen session, and keep native iOS fullscreen video-only.
- Keep one media element across summary, transcript, chat and pinned controls; preserve idle-control visibility, menu focus and native volume state.
- Animate each control surface by its own height with 240ms transform/opacity transitions; keep controls mounted and reduce motion to the fade only.
- Render summary Markdown unchanged; do not infer sections, chapters, tasks or events.
- Show the summary AI icon before its tab/heading label and put attribution in a shared hover/focus tooltip, not a separate line.
- Let CallRecordingBody own the floating details SidePanel.Layout below the full-width header; keep the details toggle in that header.
- Put Call again before Ask Macro through HeaderActionButton so both collapse at the shared 600px header threshold; keep active-call Join call below the title.
- Keep the recorded composite; separate historical camera tracks and captions are not exposed by the record contract.
- Keep metadata and entity sections on SidePanel's standard floating detail rows and dividers; keep the team-sharing card always visible below metadata, outside collapsible sections.
- Show read-only team visibility and the starter's resolved display name when sharing is not editable; use the generic starter reason instead of an email fallback, and reserve a disabled switch for pending writes.
- Put the existing fetched entity-tag pill below title metadata; keep its property reads inside a local Suspense boundary.
- Center the player and Transcript as one group at call-column widths of 1108px or more (520–720px player, 480px card, 28px gap, 80px insets, 1308px group cap); preserve the original 800px content wrapper and reading tabs below that threshold.
- Use FloatRegion ownership for phone playback instead of changing global dock state.
- Use the standard SidePanel drawer for phone details, with the same content as desktop.
- Keep one mounted transcript and video across the responsive threshold; retain the reading-tab selection, playback position and transcript follow state.
- Reuse CallWaveform from the live call feature for the active transcript; drive speaking from playback and preserve its pause, touch and reduced-motion behavior.
- Keep transcript names truncated with full-name tooltips; put the active waveform before the flush-right timestamp without reserving waveform space on inactive rows.
- Align identity to the centered group's left edge above both columns; let the left column and transcript scroll independently, with the card aligned to the video and filling the remaining pane height.
- Use Layer offset={1} and bg-surface for the wide transcript card, rounded like the player with a light-only inset edge-frame ring and shadow-md; keep Details floating over it without resetting transcript state.

- Animate the player from its measured narrow width and position while the fixed-width transcript enters on the same 240ms curve; cancel on another pane resize or fullscreen entry, and skip reduced motion.
## Checks

From `apps/web`:

- `bun run test -- src/features/block-call src/features/channel/Call/chat/CallChatHistory.test.tsx src/components/app/side-panel/SidePanel.test.tsx src/components/ui/components/ProgressPill.test.ts --maxWorkers=1`
- `bun run type-check`
- From the repository root: `just check full`
- Exercise desktop, 680px and 480px panes, and 390x844 touch with an authorized saved call; follow `docs/agent-guide/calls.md`.

## Related

- `docs/agent-guide/calls.md`: routes, playback, phone behavior and sharing.
- `.agents/rules/web/mobile.md`: insets, islands and drawer ownership.
- `.agents/rules/web/design-system.md`: shared controls and semantic tokens.
