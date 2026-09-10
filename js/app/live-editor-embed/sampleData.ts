// Dummy mention data for the marketing "live editor" demo — mirrors the
// interactive-onboarding sandbox approach (custom `entities` + `users` fed
// straight into the mentions menu, so nothing hits the backend).
import type { EntityItem } from '@core/context/quickAccess';
import type { IUser } from '@core/user/types';
import type { EntityData } from '@entity';

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

// Macro-style ids so the editor's display-name/avatar helpers resolve initials
// and names (seeded via seedMockDisplayNames in main.tsx — no network).
export const SAMPLE_USERS: IUser[] = PEOPLE.map((p) => ({
  id: `macro|${p.email}`,
  name: `${p.first} ${p.last}`,
  email: p.email,
}));

export const SAMPLE_USER_NAMES = PEOPLE.map((p) => ({
  id: `macro|${p.email}`,
  firstName: p.first,
  lastName: p.last,
}));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000);

function doc(id: string, name: string, minutes: number, fileType = 'md'): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType,
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
    frecencyScore: 1,
  } as EntityData;
}

function task(id: string, name: string, minutes: number): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
    frecencyScore: 1,
  } as EntityData;
}

function channel(id: string, name: string, minutes: number): EntityData {
  return {
    type: 'channel',
    id,
    name,
    ownerId: 'sandbox',
    channelType: 'private',
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
    frecencyScore: 1,
  } as EntityData;
}

function project(id: string, name: string, minutes: number): EntityData {
  return {
    type: 'project',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
    frecencyScore: 1,
  } as EntityData;
}

function chat(id: string, name: string, minutes: number): EntityData {
  return {
    type: 'chat',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
    frecencyScore: 1,
  } as EntityData;
}

type Bucket = 'note' | 'task' | 'channel' | 'project' | 'chat';

function item(entity: EntityData, bucket: Bucket): EntityItem {
  const updatedAt = (entity as { updatedAt: Date }).updatedAt;
  return {
    id: entity.id,
    kind: 'entity',
    bucket,
    searchText: entity.name,
    sortTimestamp: updatedAt.getTime(),
    timestamps: { updatedAt },
    data: entity,
  } as unknown as EntityItem;
}

const SAMPLE_ENTITIES: EntityItem[] = [
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

export const sampleEntities = () => SAMPLE_ENTITIES;
