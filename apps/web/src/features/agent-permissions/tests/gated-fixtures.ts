import type { GatedOperation } from '@service-agent-harness/generated/schemas';

export const SEND_MESSAGE: GatedOperation = {
  service: 'email',
  operation: 'send_message',
  label: 'Send message',
  group: 'email',
  groupName: 'Email',
  action: 'send',
  state: 'ask',
  origin: 'group_action',
};

export const DELETE_LABEL: GatedOperation = {
  service: 'email',
  operation: 'delete_label',
  label: 'Delete label',
  group: 'email',
  groupName: 'Email',
  action: 'destroy',
  state: 'never',
  origin: 'group_action',
};

export const EDIT_DOCUMENT: GatedOperation = {
  service: 'documents',
  operation: 'edit_document',
  label: 'Edit document',
  group: 'documents',
  groupName: 'Documents',
  action: 'update',
  state: 'ask',
  origin: 'tool',
};

export const RENAME_DOCUMENT: GatedOperation = {
  ...EDIT_DOCUMENT,
  operation: 'rename_document',
  label: 'Rename document',
  origin: 'group_action',
};
