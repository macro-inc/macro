# Task templates

Task templates store a name and typed task configuration. Personal templates are private to the authenticated account. Team templates are visible to current team members, including after the creator leaves. Team admins and the creator, while still a member, can manage team templates. Ownership cannot change after creation.

## Composer

The secondary template selector opens a searchable desktop dropdown or the existing touch picker sheet. No template is the default. Search is followed by No template, saved templates grouped under Personal and the team name, and New template at the bottom. The trigger shows the selected template's name, or No template with the menu's blank-page icon when none is applied; a trailing check marks its row. Managers get a row edit action on hover or keyboard focus, always available on touch.

Selecting a saved template replaces untouched template fields and description. Switching away from edited fields or prefilled task text requires confirmation. Task titles and launch-context property presets remain intact. A changed-field accent dot appears on the trigger and selected row, without modifying the shared property pills. Managers get Reset and Update template at the bottom of the picker. These actions restore or save fields only: Reset leaves task description text intact, and Update template retains the template's saved description.

New template and Edit open template mode over a preserved task draft without a replacement confirmation. The shared title editor becomes the template name without a leading icon. New template starts from draft fields and description, never the task title or attachments. Edit starts from saved defaults and keeps ownership fixed. Attachments and Create More are hidden. New-template team sharing uses the existing footer switch; editing team templates shows Shared with the owning team instead, while personal templates have no ownership label. Back and Cancel restore the task draft unchanged. Save template saves no task, then returns with the saved fields applied. Existing task prose and attachments remain intact; only a blank task description takes the saved description. Source values remain contextual and are not captured as reusable defaults. Delete template is a small secondary header action that opens the existing confirmation dialog; deletion detaches the selection without resetting the task draft.

Create More retains the selection and starts each fresh task from the saved template, not edits specific to the submitted task. Launch-context property presets, including grouped-view values and explicit assignees, remain authoritative. Its task action reads Create another. Desktop places expansion immediately left of Close. Touch keeps the existing tall composer with Save in its reachable header and Cancel in the footer.

## Markdown initialization

Task creation passes optional pinned property definition IDs through the owned
`MarkdownInitializationOptions` domain argument. Omitted pins keep implicit editor
defaults and let an empty document use the golden snapshot. An explicit empty
list is distinct: it initializes through Lexical and writes an empty pin list.
The outbound adapter maps domain options into the lexical client's options;
the HTTP request uses lexical-service's `initialPins` field and omits it when absent.
Authorization and task property policy remain in the documents domain service.

## REST contract

Creation accepts an optional client-generated `id`. Retrying the same creation ID and normalized input returns the existing template without another write. Changed content, ownership, or creator conflicts; team retries still require current membership. Persist the creation ID before sending template saves.

All routes require account authentication. JSON field names use camelCase. `GET /task_templates?teamId=<uuid>` returns a JSON array of the caller's personal templates and templates from the requested team. Without `teamId`, it returns only personal templates. A nonmember requesting a team gets 403. `GET /task_templates/{id}` reads one currently accessible template and returns 404 for inaccessible records.

`POST /task_templates` accepts `CreateTaskTemplateRequest`: `{ "teamId": uuid | null, "name": string, "configuration": TaskTemplateConfiguration }`. Omit `teamId` for a personal template. It returns a `TaskTemplate` with HTTP 201. `PUT /task_templates/{id}` accepts `UpdateTaskTemplateRequest`: `{ "revision": integer, "name": string, "configuration": TaskTemplateConfiguration }`. It replaces content without changing ownership and returns the updated `TaskTemplate`. `DELETE /task_templates/{id}?revision=<integer>` returns 204. A stale revision returns 409; missing or inaccessible templates return 404. Invalid content returns 400.

`TaskTemplateConfiguration` is `{ "propertyIds": uuid[], "defaults": PropertyDefault[], "descriptionMarkdown": string }`. `defaults` is optional and defaults to an empty array. Each `PropertyDefault` is `{ "propertyId": uuid, "value": SetPropertyValue }`, using the existing tagged property-value union. A default must refer to a listed property. Repeated `propertyIds` are deduplicated. Repeated defaults, more than 64 properties or defaults, empty names, names over 120 characters, descriptions over 16 KiB, and configurations over 32 KiB are rejected.

PostgreSQL stores this atomic configuration as JSONB. The API and domain use
`TaskTemplateConfiguration` and the tagged `SetPropertyValue` enum; the SQLx
adapter decodes JSONB into that concrete type. JSONB does not enforce property
foreign keys or value compatibility with a property's current definition.

`TaskTemplate` returns `id`, `userId` (null for team), `teamId` (null for personal), `creatorId`, `name`, `configuration`, `revision`, `createdAt`, `updatedAt`, and `canManage`. `canManage` is computed from current primary-backed membership and role facts. Content never appears in tracing fields. A template's revision starts at 1 and increments on each update. Deletes do not retain tombstones; server-generated IDs do not support replaying a deleted create.

The database cascades personal templates on account deletion and team templates on team deletion. Creator attribution becomes null on account deletion, so shared content remains without retaining the deleted account's identifier.
