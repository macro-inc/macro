import {
  type RequestActivity,
  type RequestCall,
  setDefaultRequestObserver,
} from '../../sdk/src/utils/activity';

/**
 * A workspace item a completed write created or changed. The session shows
 * it as a card, the same one the equivalent Macro tool earns; readers open
 * the item with their own access.
 */
export type ActivityItem = {
  type:
    | 'document'
    | 'email_thread'
    | 'calendar_event'
    | 'project'
    | 'channel'
    | 'form'
    | 'initiative';
  id: string;
  action:
    | 'created'
    | 'edited'
    | 'sent'
    | 'updated'
    | 'moved'
    | 'renamed'
    | 'commented'
    | 'deleted';
  title?: string;
};

/** An observed operation, with the item it changed once it completes. */
export type ObservedRequest = RequestActivity & { item?: ActivityItem };

/** Progress frames share a small budget with the run; cards past these are noise. */
const MAX_ITEMS = 32;
const MAX_TITLE = 100;

/** A field of a call's options or response, by path. */
function at(value: unknown, ...path: string[]): unknown {
  let found = value;
  for (const key of path) {
    if (found === null || typeof found !== 'object') return undefined;
    found = (found as Record<string, unknown>)[key];
  }
  return found;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const line = value.replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, MAX_TITLE) : undefined;
}

function item(
  type: ActivityItem['type'],
  id: unknown,
  action: ActivityItem['action'],
  title?: unknown
): ActivityItem | undefined {
  if (typeof id !== 'string' || !id) return;
  const name = text(title);
  return name ? { type, id, action, title: name } : { type, id, action };
}

/** Property targets by the name the properties service gives them. */
const PROPERTY_TARGETS: Record<string, ActivityItem['type']> = {
  DOCUMENT: 'document',
  PROJECT: 'project',
  CHANNEL: 'channel',
  THREAD: 'email_thread',
  INITIATIVE: 'initiative',
};

const propertyChange = (options: unknown) => {
  const type = PROPERTY_TARGETS[String(at(options, 'path', 'entity_type'))];
  return type && item(type, at(options, 'path', 'entity_id'), 'updated');
};

const created =
  (type: ActivityItem['type'], id: string[], title: string[]) =>
  (_: unknown, data: unknown) =>
    item(type, at(data, ...id), 'created', at(data, ...title));

/**
 * The writes that earn a card, by generated operation: where each finds its
 * item in the call's options (`path`, `body`) or its response data. Actions
 * match the Macro tool that does the same, so a run's cards read alike
 * whichever way the agent worked.
 */
export const RECEIPTS: Record<
  string,
  (options: unknown, data: unknown) => ActivityItem | undefined
> = {
  'storage.createMarkdownHandler': created(
    'document',
    ['documentId'],
    ['documentMetadata', 'documentName']
  ),
  'storage.createTaskHandler': (options, data) =>
    item(
      'document',
      at(data, 'documentId'),
      'created',
      at(data, 'documentMetadata', 'documentName') ??
        at(options, 'body', 'taskName')
    ),
  'storage.createSnippetHandler': (options, data) =>
    item(
      'document',
      at(data, 'documentId'),
      'created',
      at(options, 'body', 'snippetName')
    ),
  'storage.createSkillHandler': (options, data) =>
    item(
      'document',
      at(data, 'documentId'),
      'created',
      at(options, 'body', 'skillName')
    ),
  'storage.copyDocument': created(
    'document',
    ['data', 'documentMetadata', 'documentId'],
    ['data', 'documentMetadata', 'documentName']
  ),
  // One operation renames and moves; the SDK sends one change at a time.
  'storage.editDocument': (options) => {
    const id = at(options, 'path', 'document_id');
    const name = at(options, 'body', 'documentName');
    if (text(name)) return item('document', id, 'renamed', name);
    if (at(options, 'body', 'projectId') !== undefined)
      return item('document', id, 'moved');
  },
  // Comments and channel posts share an endpoint; so do other entities'.
  'storage.entityMessageCreate': (options) => {
    const id = at(options, 'path', 'parent_id');
    switch (at(options, 'path', 'parent_type')) {
      case 'document':
        return item('document', id, 'commented');
      case 'channel':
        return item('channel', id, 'sent');
    }
  },
  'storage.postChannelBotWebhook': (options) =>
    item('channel', at(options, 'path', 'channel_id'), 'sent'),
  'storage.createProjectHandler': created(
    'project',
    ['data', 'id'],
    ['data', 'name']
  ),
  'storage.editProjectV2': (options) => {
    const name = at(options, 'body', 'name');
    if (text(name))
      return item('project', at(options, 'path', 'id'), 'renamed', name);
  },
  'storage.createChannel': (options, data) =>
    item('channel', at(data, 'id'), 'created', at(options, 'body', 'name')),
  'storage.getOrCreateDm': (_, data) =>
    at(data, 'action') === 'create'
      ? item('channel', at(data, 'channel_id'), 'created')
      : undefined,
  'storage.getOrCreatePrivate': (_, data) =>
    at(data, 'action') === 'create'
      ? item('channel', at(data, 'channel_id'), 'created')
      : undefined,
  'storage.patchChannel': (options) => {
    const name = at(options, 'body', 'channel_name');
    if (text(name))
      return item(
        'channel',
        at(options, 'path', 'channel_id'),
        'renamed',
        name
      );
  },
  'properties.setEntityProperty': propertyChange,
  'properties.bulkUpdateEntityPropertyOptions': propertyChange,
  'properties.addEntityPropertyOption': propertyChange,
  'properties.removeEntityPropertyOption': propertyChange,
  'storage.createForm': created('form', ['form', 'id'], ['form', 'name']),
  'storage.updateForm': (options, data) =>
    item('form', at(options, 'path', 'id'), 'edited', at(data, 'name')),
  'storage.putFormLayout': (options) =>
    item('form', at(options, 'path', 'id'), 'edited'),
  'calendar.createCalendarEvent': created(
    'calendar_event',
    ['id'],
    ['title']
  ),
  'calendar.updateCalendarEvent': (options, data) =>
    item(
      'calendar_event',
      at(options, 'path', 'event_id'),
      'edited',
      at(data, 'title')
    ),
  'calendar.deleteCalendarEvent': (options) =>
    item('calendar_event', at(options, 'path', 'event_id'), 'deleted'),
  'email.sendMessage': (options, data) =>
    item(
      'email_thread',
      at(data, 'message', 'thread_db_id') ??
        at(options, 'body', 'message', 'thread_db_id'),
      'sent',
      at(options, 'body', 'message', 'subject')
    ),
  'email.updateThreadProject': (options) =>
    item('email_thread', at(options, 'path', 'thread_id'), 'moved'),
  'storage.createInitiative': created('initiative', ['id'], ['name']),
  'storage.updateInitiative': (options, data) =>
    item(
      'initiative',
      at(options, 'path', 'initiative_id'),
      'updated',
      at(data, 'name')
    ),
};

/** The item a completed call changed, if its operation earns a card. */
export function receipt(
  event: RequestActivity,
  call: RequestCall
): ActivityItem | undefined {
  if (event.status !== 'completed') return;
  const read = RECEIPTS[`${event.service}.${event.operation}`];
  try {
    return read?.(call.args[0], at(call.result, 'data'));
  } catch {
    // A response this table misreads earns no card; the call still succeeded.
    return;
  }
}

/** Install the runtime's observer: every operation, and what each write changed. */
export function observeRequests(observer: (event: ObservedRequest) => void) {
  let items = 0;
  setDefaultRequestObserver((event, call) => {
    const item = items < MAX_ITEMS ? receipt(event, call) : undefined;
    if (!item) return observer(event);
    items += 1;
    observer({ ...event, item });
  });
}
