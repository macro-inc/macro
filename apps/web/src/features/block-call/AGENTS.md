# Saved call detail

## What it is

Saved call recordings, transcripts, summary Markdown and read-only discussion.
The live call UI belongs to `features/channel/Call`, not this feature.

## Start here

- `views/CallDetailView.tsx`: native route hosts, query, header and loading states.
- `component/CallRecording/CallRecordingBody.tsx`: one playback owner and responsive composition.
- `component/CallTranscript.tsx`: transcript rows, inline chat and follow/seek behavior.
- `component/sidepanel/CallSidePanelSections.tsx`: existing metadata, sharing and entity sections.
- `primitives/recording-playback.ts`: native media state and actions.
- `core/recording-chat.ts`: visible messages and valid recording offsets.

## Boundaries

- Read records through `useCallRecordQuery`; keep storage and SDK contracts unchanged.
- Read discussion through `CallDiscussionHistory`'s source slot; preserve channel authorization and canonical call-chat roots.
- Keep one media element across summary, transcript, chat and pinned controls.
- Render summary Markdown unchanged; do not infer sections, chapters, tasks or events.
- Let CallRecordingBody own the only SidePanel.Layout; native and legacy hosts provide the root and header, never a second layout.
- Keep the recorded composite; separate historical camera tracks and captions are not exposed by the record contract.
- Keep metadata and entity sections on SidePanel's unframed rows; only team sharing gets a card.
- Keep reading tabs unframed; let the shared Tabs component own the track and selected state.
- Use FloatRegion ownership for phone playback instead of changing global dock state.
- Keep the phone Details close action in the SidePanel drawer-header slot, outside its ScrollBody.

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
