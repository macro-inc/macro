import type { NamedTool } from '@service-cognition/generated/tools/tool';

export type FormMutation = NamedTool<'CreateForm', 'response'>['data'];
export type SavedForm = NonNullable<FormMutation['saved']>;
