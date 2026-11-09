# Task templates

## What it is

Personal and team task templates for the existing task composer. Templates store
selected property definitions, optional default values, and description Markdown.
Task creation also preserves the composer's selected fields as per-task pins.

## Start here

- `core/template.ts`: fill-blank application and reusable-default capture.
- `components/template-picker.tsx`: searchable desktop dropdown and touch picker sheet.
- `task-template-controls.tsx`: template selection, draft-preserving template mode header, and scoped confirmation dialogs.
- `../task-composer/primitives/template-workflow.ts`: isolated editing, durable creation identities, and field-only updates.

## Scope

- Keep task titles, sharing mode, and attachments outside template content.
- Replace untouched template fields directly; confirm before switching away from edited fields or task description.
- Preserve task titles, contextual Source values, and explicit launch presets across template replacement.
- Detach a deleted selected template without resetting the current draft.
- Treat zero and false as populated values; treat empty lists and text as blank.
- Retain blank selected fields so creation can pin them below the task title.
- Include host-controlled fields in template defaults and pins without duplicating their controls.
- Keep Source references contextual; capture the Source field without its current value.
- Wait for property definitions before applying, editing, or saving templates; apply only definitions available to the viewer.
- Preserve settings for unavailable fields when editing a template.
- Keep No template as the default, and retain the selected template across Create More.
- Reapply saved defaults to fresh tasks while preserving launch-context property presets, not task-specific edits.
- Open New template and Edit as a separate template editing session; keep the underlying task draft unchanged until saving.
- Return to the unchanged task draft on Back or Cancel; save only the template, then return with it applied.
- Preserve existing task prose and attachments when applying a saved editing session; fill description only when the task is blank.
- Use the task title editor for the template name without a leading icon; hide attachments and Create More.
- Keep new-template ownership on the footer's team switch.
- Show Shared with the owning team when editing team templates; show no ownership label for personal templates.

## Boundaries

- Personal templates sync with their owner's account.
- Current team members can create and use team templates.
- The creator and current team admins can edit or delete team templates.
- Team templates remain with the team after creator departure or account deletion.
- Keep ownership immutable when editing a template.
- Gate management actions on the current team and server-returned management permission.
- Close management dialogs when the account, team, or edited selection changes.
- Keep authorization and persistence in `crates/task_templates`; use generated API types.
- Use focused confirmation dialogs for destructive actions; do not open a separate template content editor.
- Put No template after search, group templates under Personal and the team name, and put New template last.
- Apply menu padding once around choices; keep grouped labels on the shared dropdown spacing.
- Reuse `DropdownSearchInput` for flush, divided search matching the assignee selector.
- Match trailing selection checks to `PropertyEntitySelector` using its check icon and classes.
- Overlay the edit action within the full-width row; reveal it on hover, keyboard focus, and touch.
- Use a secondary selection trigger and the existing touch picker sheet; keep empty states brief.
- Show an accent dot for changed template fields, not task title or description changes; keep property pills unchanged.
- Follow saved-view actions with Reset and Update template for managers; reset or save fields without changing description text.

## Checks

- `bun run test src/features/task-templates src/features/task-composer` from `apps/web`.
- `bun run check` from `apps/web`, then `just check` from the repository root.
- Check application against existing draft text, contextual Source/Project values,
  empty custom fields, deleted definitions, and Create More.
- Check personal isolation, team member use, creator/admin management, and former-member denial.

## Gotchas

- Keep composer visibility separate from global defaults and existing task pins.
- Capture template application and task submission independently of later draft edits.
- Persist template editing separately from the underlying task draft; retain creation identities across retries.
- Persist the last applied task baseline so switching templates still confirms restored task edits.
- Run local validation in this worktree's named stack without resetting seeded data.
- Hand visual checks to the user; do not launch browser automation.
