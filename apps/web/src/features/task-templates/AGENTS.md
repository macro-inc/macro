# Task templates

## What it is

Personal and team task templates for the existing task composer. Templates store
selected property definitions, optional default values and task title, task sharing, and description Markdown.
Task creation also preserves the composer's selected fields as per-task pins.

## Start here

- `core/template.ts`: fill-blank application and reusable-default capture.
- `components/template-picker.tsx`: searchable desktop dropdown and touch picker sheet.
- `task-template-controls.tsx`: template selection, draft-preserving template mode header, and scoped confirmation dialogs.
- `../task-composer/primitives/template-workflow.ts`: isolated editing, durable creation identities, and field-only updates.
- `../task-composer/property-defaults.ts`: default composer fields and creation-time pin selection.

## Scope

- Store optional default task title and `shareWithTeam` separately from the template name and ownership; exclude attachments.
- Gate desktop and touch template controls, queries, authoring, recovery, and repeated application with `enable-task-templates`.
- Inject reactive availability from `ComposeTask`; preserve paused editor buffers and replay identities while disabled.
- Leave ordinary task creation and property pinning available; the flag is a web rollout, not REST or SDK authorization.
- Replace untouched template fields and task text directly; confirm before replacing edited fields, title, or description.
- Preserve contextual Source values and explicit launch property presets across template replacement.
- Detach a deleted selected template without resetting the current draft.
- Treat zero and false as populated values; treat empty lists and text as blank.
- Retain blank selected fields so creation can pin them below the task title.
- Include host-controlled fields in template defaults and pins without duplicating their controls.
- Keep Source references contextual through `TASK_TEMPLATE_CONTEXTUAL_PROPERTY_IDS`; capture the field without its value.
- Wait for property definitions before applying, editing, or saving templates; apply only definitions available to the viewer.
- Unwrap reactive query defaults before decoding templates into cloneable draft values.
- Preserve settings for unavailable fields when editing a template.
- Keep No template as the default, and retain the selected template across Create More.
- Label task submission Create another while Create More is enabled.
- Reapply saved defaults, including task sharing, to fresh tasks while preserving launch-context property presets, not task-specific edits.
- Open New template and Edit as a separate template editing session; keep the underlying task draft unchanged until saving.
- Return to the unchanged task draft on Back or Cancel; save only the template, then return with it applied.
- Preserve existing task title, prose, and attachments after saving a template; fill title and description only when blank.
- Put New template or Edit template on the header back action; keep Delete and the existing Close or sheet Save action unchanged.
- Edit template names with a borderless shared `Input`; retain keyboard focus styling, focus only new names, and disable editing during saves.
- Put immutable team ownership beside the name; use a Share with team switch for new templates and omit personal ownership when editing.
- Stack visibility below the unframed name row on phones; keep the task-title editor independent.
- Keep attachments and Create More hidden in template mode.
- Keep template visibility in the name strip separate from the footer's task-sharing switch.
- Capture and apply the optional task-sharing default; leave the switch unchanged when absent and ignore it without a team.
- Include task sharing in changed-field dots, Reset, and Update template; preserve task title and description during those actions.
- Preserve task sharing through template cancellation and draft recovery; keep template edits out of global sharing defaults.

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
- Overlay the edit action within the full-width row using the shared icon-button recipe; reveal it on hover, keyboard focus, and touch.
- Use a secondary trigger showing No template with the menu's blank-page icon when no template is applied.
- Retain the compact touch trigger's accessible label and the existing touch picker sheet; keep empty states brief.
- Show an accent dot for changed template fields, not task title or description changes; keep property pills unchanged.
- Follow saved-view actions with Reset and Update template for managers; reset or save fields without changing task title or description.

## Checks

- `bun run test src/features/task-templates src/features/task-composer` from `apps/web`.
- `bun run check` from `apps/web`, then `just check` from the repository root.
- Check title and task-sharing capture, application, omitted sharing defaults, draft recovery, and repeated creation.
- Check enabled, disabled, and loading flags; retain template edits across disable/re-enable and reject late saves from a disabled session.
- Check task-sharing dots, Reset, Update, personal templates creating shared tasks, and team templates creating private tasks.
- Check application against existing draft text, contextual Source/Project values,
  empty custom fields, deleted definitions, and Create More.
- Check personal isolation, team member use, creator/admin management, and former-member denial.

## Gotchas

- Keep composer visibility separate from global defaults and existing task pins.
- Capture template application and task submission independently of later draft edits.
- Exclude active submissions from recovery lists; keep their input durable until task creation is confirmed.
- Persist template editing separately from the task draft; keep the immutable retry request only in `templateEditor.request`.
- Persist the last applied task baseline so switching templates still confirms restored task edits.
- Run local validation in this worktree's named stack without resetting seeded data.
- Hand visual checks to the user; do not launch browser automation.
