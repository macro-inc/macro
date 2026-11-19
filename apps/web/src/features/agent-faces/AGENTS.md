# agent-faces

## What it is

Agent teammates' pictures in the web app: choosing a generated face (or a
photo) when an agent is added, and changing it later from its row in Members.
Faces come from `@macro-inc/agent-faces` (`packages/agent-faces`); `UserIcon`
draws them everywhere else. Behind `ENABLE_AGENT_FACES` (env-only, on in dev).

## Start here

- `face-slot.tsx`: the device switch; desktop popover in `views/face-slot.tsx`,
  touch sheet in `views/mobile/face-slot.tsx`.
- `components/face-editor.tsx`: tabs of parts, Shuffle / Upload photo / Reset.
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
- Every part needs a tab in `core/face-tabs.ts`; the type fails otherwise.
