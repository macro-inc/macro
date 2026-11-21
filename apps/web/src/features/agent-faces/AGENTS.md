# agent-faces

## What it is

Agent teammates' pictures in the web app: choosing a generated face (or a
photo) when an agent is added, and changing it later from its row in Members.
Faces come from `@macro-inc/agent-faces` (`packages/agent-faces`); `UserIcon`
draws them everywhere else. Behind `ENABLE_AGENT_FACES` (env-only, on in dev).

## Start here

- `face-slot.tsx`: the device switch; desktop popover in `views/face-slot.tsx`,
  touch sheet in `views/mobile/face-slot.tsx`.
- `components/face-editor.tsx`: eight suggested faces (`primitives/create-face-suggestions.ts`;
  New faces replaces them, the chosen face stays), tabs of parts, Upload photo / Reset.
- `primitives/create-face-draft.ts`: the face or photo being chosen.
- `primitives/upload-agent-picture.ts`: PNG + static upload; a face never fails.
- `views/change-picture-dialog.tsx`: edit later, saved on Save.

## Boundaries

- Used by: `features/settings/views/invite-agent-panel.tsx`,
  `features/settings/components/agent-picture-dialog.tsx`.
- Saves through `@queries/team-agents/avatar` (`PUT /team_agents/{id}/avatar`).

## Checks

- `bunx vitest run src/features/agent-faces src/lib/core/user/agent-face.test.ts src/lib/core/component/UserIcon.faces.test.tsx`

## Gotchas

- An unsaved agent's face is `derivedAgentFace(userId)` (`@core/user/agent-face`):
  a hashed seed, so saving it unchanged keeps the same face and fits the
  server's 64-character seed limit. Never seed from the raw id.
- Wait for a successful profile-picture read before mounting an edit draft; an
  unknown picture is a loading/error state, never a generated-face default.
- Guard upload continuations by opening lifetime and account; freeze picture
  controls while saving and abort writes when their account scope retires.
- Saved photos use a saved URL draft and are not uploaded again; only object
  URLs created for picked files are revoked on replacement or cleanup.
- Each part can be unpinned independently with Any; the slot's ↻ (Shuffle face) keeps pins.
- Choosing a suggestion replaces the face, pins included; New faces never changes the chosen face.
- Every part needs a tab in `core/face-tabs.ts`; the type fails otherwise.
