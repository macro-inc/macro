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
- Keep one media element across summary, transcript, chat and pinned controls; preserve idle-control visibility, menu focus and native volume state.
- Animate each control surface by its own height with 240ms transform/opacity transitions; keep controls mounted and reduce motion to the fade only.
- Render summary Markdown unchanged; do not infer sections, chapters, tasks or events.
- Let CallRecordingBody own the floating details SidePanel.Layout below the full-width header; keep the details toggle in that header.
- Keep the recorded composite; separate historical camera tracks and captions are not exposed by the record contract.
- Keep metadata and entity sections on SidePanel's standard floating detail rows and dividers; keep the team-sharing card always visible below metadata, outside collapsible sections.
- Show read-only team visibility and the starter's resolved display name when sharing is not editable; use the generic starter reason instead of an email fallback, and reserve a disabled switch for pending writes.
- Put the existing fetched entity-tag pill below title metadata; keep its property reads inside a local Suspense boundary.
- Show Summary beside the raised Transcript card at call-column widths of 948px or more (520px player, 320px card, 28px gap, 80px insets); use reading tabs below that container threshold.
- Use FloatRegion ownership for phone playback instead of changing global dock state.
- Use the standard SidePanel drawer for phone details, with the same content as desktop.
- Keep one mounted transcript and video across the responsive threshold; retain the reading-tab selection, playback position and transcript follow state.
- Keep the full-width identity above both columns; let the left column and transcript scroll independently, with the card aligned to the video and filling the remaining pane height.
- Use Layer offset={1} and bg-surface for the wide transcript card, rounded like the player without a border or shadow; keep Details floating over it without resetting transcript state.

## Checks

From `apps/web`:

- `bun run test -- src/features/block-call src/features/channel/Call/chat/CallChatHistory.test.tsx src/components/app/side-panel/SidePanel.test.tsx src/components/ui/components/ProgressPill.test.ts --maxWorkers=1`
- `bun run type-check`
- From the repository root: `just check full`
- `bunx playwright test --config src/features/block-call/browser-test/playwright.config.ts`: backend-free playback, volume dragging, control frame timing and responsive-card geometry, themes, navigation and overlapping card state.
- Exercise desktop, 680px and 480px panes, and 390x844 touch with an authorized saved call; follow `docs/agent-guide/calls.md`.

## Related

- `docs/agent-guide/calls.md`: routes, playback, phone behavior and sharing.
- `.agents/rules/web/mobile.md`: insets, islands and drawer ownership.
- `.agents/rules/web/design-system.md`: shared controls and semantic tokens.
