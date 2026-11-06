# Task templates

Task templates store a name and typed task configuration. Personal templates are private to the authenticated account. Team templates are visible to current team members, including after the creator leaves. Team admins and the creator, while still a member, can manage team templates. Ownership cannot change after creation.

## Composer

The secondary template selector opens a searchable desktop dropdown or a touch picker sheet. No template is the default; New template follows it above a divider, then saved personal and team templates. The trigger shows the current selection. Choosing No template preserves the current draft but stops template reuse. Applying a saved template only fills blank fields and description text.

New template uses the composer's fields, defaults, and description with inline name and ownership metadata. Without a task title, Create template saves only the template, including empty selected fields. With a title, Create task & template saves the template before creating the task. Keep the confirmed template identity if task creation needs recovery, so recovery does not save a second template. Source values remain contextual and are not captured as reusable defaults.

Create More retains the selection and starts each fresh task from the saved template, not edits specific to the submitted task. Launch-context property presets, including grouped-view values and explicit assignees, remain authoritative. Its normal action reads Create & add another; the first combined save reads Create task & template, then another. After saving a new template, reuse that saved template for subsequent tasks.

Editing loads the template into the same composer, confirms replacement of an unsaved draft, and saves template changes without creating a task. Ownership stays immutable. Deletion always asks for confirmation. Desktop places expansion immediately left of Close.

## REST contract

Creation accepts an optional client-generated `id`. Retrying the same creation ID and normalized input returns the existing template without another write. Changed content, ownership, or creator conflicts; team retries still require current membership. Persist the creation ID before sending combined or template-only submissions.

All routes require account authentication. JSON field names use camelCase. `GET /task_templates?teamId=<uuid>` returns a JSON array of the caller's personal templates and templates from the requested team. Without `teamId`, it returns only personal templates. A nonmember requesting a team gets 403. `GET /task_templates/{id}` reads one currently accessible template and returns 404 for inaccessible records.

`POST /task_templates` accepts `CreateTaskTemplateRequest`: `{ "teamId": uuid | null, "name": string, "configuration": TaskTemplateConfiguration }`. Omit `teamId` for a personal template. It returns a `TaskTemplate` with HTTP 201. `PUT /task_templates/{id}` accepts `UpdateTaskTemplateRequest`: `{ "revision": integer, "name": string, "configuration": TaskTemplateConfiguration }`. It replaces content without changing ownership and returns the updated `TaskTemplate`. `DELETE /task_templates/{id}?revision=<integer>` returns 204. A stale revision returns 409; missing or inaccessible templates return 404. Invalid content returns 400.

`TaskTemplateConfiguration` is `{ "propertyIds": uuid[], "defaults": PropertyDefault[], "descriptionMarkdown": string }`. `defaults` is optional and defaults to an empty array. Each `PropertyDefault` is `{ "propertyId": uuid, "value": SetPropertyValue }`, using the existing tagged property-value union. A default must refer to a listed property. Repeated `propertyIds` are deduplicated. Repeated defaults, more than 64 properties or defaults, empty names, names over 120 characters, descriptions over 16 KiB, and configurations over 32 KiB are rejected.

`TaskTemplate` returns `id`, `userId` (null for team), `teamId` (null for personal), `creatorId`, `name`, `configuration`, `revision`, `createdAt`, `updatedAt`, and `canManage`. `canManage` is computed from current primary-backed membership and role facts. Content never appears in tracing fields. A template's revision starts at 1 and increments on each update. Deletes do not retain tombstones; server-generated IDs do not support replaying a deleted create.

The database cascades personal templates on account deletion and team templates on team deletion. Creator attribution becomes null on account deletion, so shared content remains without retaining the deleted account's identifier.
