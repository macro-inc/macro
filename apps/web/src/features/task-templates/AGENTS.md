# Task templates

## What it is

Personal and team task templates for the existing task composer. Templates store
selected property definitions, optional default values, and description Markdown.
Task creation also preserves the composer's selected fields as per-task pins.

## Start here

- `core/template.ts`: fill-blank application and reusable-default capture.
- `components/template-picker.tsx`: searchable desktop dropdown and touch picker sheet.
- `components/template-form.tsx`: template name, fields, description, and scope.

## Scope

- Keep task titles, sharing mode, and attachments outside template content.
- Preserve existing draft text and populated property values when applying a template.
- Treat zero and false as populated values; treat empty lists and text as blank.
- Retain blank selected fields so creation can pin them below the task title.
- Keep Source references contextual; capture the Source field without its current value.
- Apply only property definitions available to the current viewer.
- Preserve settings for unavailable fields when editing a template.

## Boundaries

- Personal templates sync with their owner's account.
- Current team members can create and use team templates.
- The creator and current team admins can edit or delete team templates.
- Team templates remain with the team after creator departure or account deletion.
- Keep ownership immutable when editing a template.
- Keep authorization and persistence in `crates/task_templates`; use generated API types.
- Open focused dialogs with `openDialog`; the shared Dialog supplies phone drawers.
- Put Create template first above a divider, use a secondary trigger, and explain empty and unmatched lists.

## Checks

- `bun run test src/features/task-templates` from `apps/web`.
- `bun run check` from `apps/web`, then `just check` from the repository root.
- Check application against existing draft text, contextual Source/Project values,
  empty custom fields, deleted definitions, and Create More.
- Check personal isolation, team member use, creator/admin management, and former-member denial.

## Gotchas

- Keep composer visibility separate from global defaults and existing task pins.
- Capture template application and task submission independently of later draft edits.
- Run local validation in this worktree's named stack without resetting seeded data.
- Hand visual checks to the user; do not launch browser automation.
