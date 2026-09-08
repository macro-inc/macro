/**
 * Static @mention data for the marketing live-editor demo.
 *
 * The demo has no backend, so `withMentions` is fed these lists directly via
 * its `entities` / `users` overrides instead of `quickAccess`. Shapes were
 * recovered from the previously shipped bundle (whose source was never
 * committed) so the menu renders exactly as it does on the live site today.
 *
 * Everything here is invented. Do not point it at real people or documents.
 */

const NOW = Date.now();
/** A timestamp `mins` minutes in the past, so the menu's ordering looks lived-in. */
const ago = (mins: number) => new Date(NOW - mins * 60_000);

const PEOPLE = [
  { first: 'Sarah', last: 'Chen', email: 'sarah@example.com' },
  { first: 'Marcus', last: 'Lee', email: 'marcus@example.com' },
  { first: 'Jordan', last: 'Rivera', email: 'jordan@example.com' },
  { first: 'Alex', last: 'Kim', email: 'alex@example.com' },
  { first: 'Priya', last: 'Patel', email: 'priya@example.com' },
  { first: 'David', last: 'Okafor', email: 'david@example.com' },
  { first: 'Emily', last: 'Zhang', email: 'emily@example.com' },
  { first: 'Yuki', last: 'Tanaka', email: 'yuki@example.com' },
];

export const demoUsers = PEOPLE.map((p) => ({
  id: `macro|${p.email}`,
  name: `${p.first} ${p.last}`,
  email: p.email,
}));

/** The shape `setUsers`-style consumers expect, kept alongside for parity. */
export const demoUserRecords = PEOPLE.map((p) => ({
  id: `macro|${p.email}`,
  firstName: p.first,
  lastName: p.last,
}));

const base = (type: string, id: string, name: string, mins: number) => ({
  type,
  id,
  name,
  ownerId: 'sandbox',
  createdAt: ago(mins),
  updatedAt: ago(mins),
  frecencyScore: 1,
});

const doc = (id: string, name: string, mins: number, fileType = 'md') => ({
  ...base('document', id, name, mins),
  fileType,
});

const task = (id: string, name: string, mins: number) => ({
  ...doc(id, name, mins),
  subType: { type: 'task', is_completed: false },
});

const channel = (id: string, name: string, mins: number) => base('channel', id, name, mins);
const project = (id: string, name: string, mins: number) => base('project', id, name, mins);
const chat = (id: string, name: string, mins: number) => base('chat', id, name, mins);

/** Wraps an entity in the bucket envelope the mention menu groups by. */
const item = (entity: ReturnType<typeof base>, bucket: string) => ({
  id: entity.id,
  kind: 'entity' as const,
  bucket,
  searchText: entity.name,
  sortTimestamp: entity.updatedAt.getTime(),
  timestamps: { updatedAt: entity.updatedAt },
  data: entity,
});

const ENTITIES = [
  item(doc('d_roadmap', 'Q3 Product Roadmap', 30), 'note'),
  item(doc('d_adr', 'Architecture Decision Record', 90), 'note'),
  item(doc('d_notes', 'Meeting Notes — All Hands', 240), 'note'),
  item(doc('d_spec', 'Realtime Editing Spec', 12), 'note'),
  item(task('t_v1', 'Ship V1 of the editor', 45), 'task'),
  item(task('t_review', 'Review design mockups', 180), 'task'),
  item(task('t_ci', 'Set up CI pipeline', 600), 'task'),
  item(channel('c_gtm', 'go-to-market', 20), 'channel'),
  item(channel('c_eng', 'engineering', 75), 'channel'),
  item(channel('c_design', 'design', 320), 'channel'),
  item(project('p_launch', 'Launch', 150), 'project'),
  item(chat('ch_brainstorm', 'Brainstorm: onboarding flow', 95), 'chat'),
];

export const demoEntities = () => ENTITIES as never;
export const demoUsersGetter = () => demoUsers as never;
/** Same list, for the QuickAccess stub's getById lookup. */
export const demoQuickAccessItems = ENTITIES;
