# Task templates

## What it is

Personal and team task templates for the existing task composer. Templates store
selected property definitions, optional default values, and description Markdown.
Task creation also preserves the composer's selected fields as per-task pins.

## Start here

- `core/template.ts`: fill-blank application and reusable-default capture.
- `components/template-picker.tsx`: searchable desktop dropdown and touch picker sheet.
- `components/template-details.tsx`: compact name/scope row with desktop tooltips and tap-to-open touch help; name autofocus is desktop-only.

## Scope

- Keep task titles, sharing mode, and attachments outside template content.
- Replace untouched template fields directly; confirm before replacing edited fields, metadata, or prefilled task text.
- Preserve task titles, contextual Source values, and explicit launch presets across template replacement.
- Detach a deleted selected template without resetting the current draft.
- Treat zero and false as populated values; treat empty lists and text as blank.
- Retain blank selected fields so creation can pin them below the task title.
- Keep Source references contextual; capture the Source field without its current value.
- Wait for property definitions before applying, editing, or saving templates; apply only definitions available to the viewer.
- Preserve settings for unavailable fields when editing a template.
- Keep No template as the default, and retain the selected template across Create More.
- Reapply saved defaults to fresh tasks while preserving launch-context property presets, not task-specific edits.
- Use New template to save composer fields alone, or a task and template when a task title exists.
- Edit templates in the same composer, confirm replacing an unsaved draft, and confirm deletion.

## Boundaries

- Personal templates sync with their owner's account.
- Current team members can create and use team templates.
- The creator and current team admins can edit or delete team templates.
- Team templates remain with the team after creator departure or account deletion.
- Keep ownership immutable when editing a template.
- Keep authorization and persistence in `crates/task_templates`; use generated API types.
- Use focused confirmation dialogs for destructive actions; do not open a separate template content editor.
- Put No template and New template above a divider, use a secondary selection trigger, and keep empty states brief.
- Keep template metadata in one compact row; move necessary feature explanations into info help.

## Checks

- `bun run test src/features/task-templates src/features/task-composer` from `apps/web`.
- `bun run check` from `apps/web`, then `just check` from the repository root.
- Check application against existing draft text, contextual Source/Project values,
  empty custom fields, deleted definitions, and Create More.
- Check personal isolation, team member use, creator/admin management, and former-member denial.

## Gotchas

- Keep composer visibility separate from global defaults and existing task pins.
- Capture template application and task submission independently of later draft edits.
- Persist the last programmatic template baseline so restored edits and cleared fields still require confirmation.
- Run local validation in this worktree's named stack without resetting seeded data.
- Hand visual checks to the user; do not launch browser automation.
