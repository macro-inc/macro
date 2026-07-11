import type { IUser } from '@core/user/types';
import type { EntityData } from '@entity';
import { createSignal } from 'solid-js';
import {
  MOCK_DOCUMENT_BASIC,
  MOCK_PROJECT_1,
} from '../../../../entity/mocks/mockEntityData';

const now = new Date();

/** Returns a Date that is `minutesAgo` minutes before `now`. */
function ago(minutesAgo: number): Date {
  return new Date(now.getTime() - minutesAgo * 60_000);
}

function seedDoc(
  id: string,
  name: string,
  updatedAt: Date,
  fileType = 'md'
): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType,
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedTask(id: string, name: string, updatedAt: Date): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedEmail(
  id: string,
  name: string,
  senderName: string,
  senderEmail: string,
  snippet: string,
  updatedAt: Date,
  isRead = false
): EntityData {
  return {
    type: 'email',
    id,
    name,
    ownerId: 'sandbox',
    isRead,
    isDraft: false,
    isImportant: false,
    done: false,
    senderEmail,
    senderName,
    snippet,
    participants: [],
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedChannel(id: string, name: string, updatedAt: Date): EntityData {
  return {
    type: 'channel',
    id,
    name,
    ownerId: 'sandbox',
    channelType: 'private',
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedProject(id: string, name: string, updatedAt: Date): EntityData {
  return {
    type: 'project',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedChat(id: string, name: string, updatedAt: Date): EntityData {
  return {
    type: 'chat',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}
function seedDM(id: string, name: string, updatedAt: Date): EntityData {
  return {
    type: 'channel',
    id,
    name,
    ownerId: 'sandbox',
    channelType: 'direct_message',
    createdAt: updatedAt,
    updatedAt,
    frecencyScore: 1,
  };
}

// Sorted by updatedAt descending so the "all" view is interleaved by type.
const SEED_ENTITIES: EntityData[] = [
  seedChannel('seed_channel_1', 'engineering', ago(5)),
  seedEmail(
    'seed_email_1',
    'Re: Launch checklist',
    'Sarah Chen',
    'sarah@example.com',
    'Just reviewed the checklist — a few items still need sign-off before we go live on Friday.',
    ago(35)
  ),
  seedChat('seed_chat_1', 'Brainstorm: onboarding flow', ago(90)),
  seedTask('seed_task_1', 'Review design mockups', ago(180)),
  seedDM('seed_dm_1', 'Sarah Chen', ago(300)),
  seedDoc('seed_doc_1', 'Q3 Product Roadmap', ago(480)),
  seedEmail(
    'seed_email_2',
    'Budget approval needed',
    'Marcus Lee',
    'marcus@example.com',
    'The Q4 vendor contracts are ready. We need approval by EOD Thursday to avoid delays.',
    ago(720)
  ),
  seedChannel('seed_channel_2', 'design', ago(960)),
  seedChat('seed_chat_2', 'Draft: pricing page copy', ago(60 * 20)),
  seedTask('seed_task_2', 'Write release notes', ago(60 * 26)),
  MOCK_PROJECT_1,
  seedDM('seed_dm_2', 'Marcus Lee', ago(60 * 30)),
  seedDoc('seed_doc_2', 'Architecture Decision Record', ago(60 * 36)),
  seedEmail(
    'seed_email_3',
    'Investor update Q3',
    'Jordan Rivera',
    'jordan@example.com',
    'Attaching the draft deck for your review. Key highlights: ARR up 34%, churn down to 2.1%.',
    ago(60 * 44),
    true
  ),
  seedChannel('seed_channel_3', 'announcements', ago(60 * 52)),
  seedTask('seed_task_3', 'Set up CI pipeline', ago(60 * 60)),
  seedChat('seed_chat_3', 'Debug: auth token expiry', ago(60 * 72)),
  seedDoc('seed_doc_3', 'Meeting Notes — All Hands', ago(60 * 84)),
  seedDM('seed_dm_3', 'Jordan Rivera', ago(60 * 96)),
  seedProject('seed_project_2', 'Website Redesign', ago(60 * 120)),
  seedEmail(
    'seed_email_4',
    'Contract renewal — action required',
    'Alex Kim',
    'alex@example.com',
    'Your annual subscription renews in 7 days. Please confirm billing details to avoid interruption.',
    ago(60 * 144),
    true
  ),
  seedTask('seed_task_4', 'Fix login page regression', ago(60 * 168)),
  seedChannel('seed_channel_4', 'product', ago(60 * 200)),
  seedChat('seed_chat_4', 'Summarize: customer feedback Q3', ago(60 * 240)),
  seedDoc('seed_doc_4', 'Customer Interview Summary', ago(60 * 288), 'canvas'),
  seedDM('seed_dm_4', 'Priya Patel', ago(60 * 336)),
  MOCK_DOCUMENT_BASIC,
  seedEmail(
    'seed_email_5',
    'Design review feedback',
    'Emily Zhang',
    'emily@example.com',
    'Overall looking great! Left a few comments on the nav and the mobile breakpoints.',
    ago(60 * 400),
    true
  ),
  seedTask('seed_task_5', 'Update dependencies', ago(60 * 480)),
  seedChannel('seed_channel_5', 'random', ago(60 * 560)),
  seedChat('seed_chat_5', 'Code review: payments module', ago(60 * 650)),
  seedDoc('seed_doc_5', 'API Reference', ago(60 * 750), 'py'),
  seedDM('seed_dm_5', 'Alex Kim', ago(60 * 840)),
  seedProject('seed_project_3', 'Mobile App v2', ago(60 * 960)),
  seedTask('seed_task_6', 'Schedule user research sessions', ago(60 * 1100)),
  seedTask('seed_task_7', 'Review Q1 Budget', ago(60 * 1200)),
  seedDoc('seed_doc_6', 'Brand Guidelines', ago(60 * 1300)),
  seedChat('seed_chat_6', 'Research: competitor analysis', ago(60 * 1500)),
  seedEmail(
    'seed_email_6',
    'Q1 Planning Session',
    'Alice Johnson',
    'alice@example.com',
    "Sending the agenda ahead of Thursday's session. Please come with your top 3 priorities.",
    ago(60 * 1700),
    true
  ),
  seedChannel('seed_channel_6', 'general', ago(60 * 1900)),
];

const [entities, setEntities] = createSignal<EntityData[]>([...SEED_ENTITIES]);

let entityCounter = 0;

// -- Sidebar filter --

export type SandboxSidebarFilter =
  | 'agents'
  | 'mail'
  | 'documents'
  | 'tasks'
  | 'channels'
  | 'folders'
  | 'empty'
  | null;

const [sidebarFilter, setSidebarFilter] =
  createSignal<SandboxSidebarFilter>('empty');

export { setSidebarFilter, sidebarFilter };

function matchesFilter(
  entity: EntityData,
  filter: SandboxSidebarFilter
): boolean {
  if (!filter) return true;
  switch (filter) {
    case 'empty':
      return false;
    case 'agents':
      return entity.type === 'chat';
    case 'mail':
      return entity.type === 'email';
    case 'documents':
      return entity.type === 'document' && entity.subType?.type !== 'task';
    case 'tasks':
      return entity.type === 'document' && entity.subType?.type === 'task';
    case 'channels':
      return entity.type === 'channel';
    case 'folders':
      return entity.type === 'project';
    default:
      return true;
  }
}

function sandboxEntities() {
  return entities();
}

export function filteredSandboxEntities() {
  const filter = sidebarFilter();
  if (!filter) return entities();
  return entities().filter((e) => matchesFilter(e, filter));
}

export function addSandboxEntity(entity: EntityData) {
  setEntities((prev) => [entity, ...prev]);
}

function _removeSandboxEntity(id: string) {
  setEntities((prev) => prev.filter((e) => e.id !== id));
}

export type SandboxEntityType =
  | 'md'
  | 'snippet'
  | 'email'
  | 'task'
  | 'channel'
  | 'chat'
  | 'canvas'
  | 'project'
  | 'code';

const SAMPLE_NAMES: Record<SandboxEntityType, string> = {
  md: 'My Sample Document',
  snippet: 'My Sample Snippet',
  email: 'My Sample Email Draft',
  task: 'My Sample Task',
  channel: 'My Sample Message',
  chat: 'My Sample Agent Chat',
  canvas: 'My Sample Canvas',
  project: 'My Sample Folder',
  code: 'My Sample Code File',
};

export function createSandboxEntity(type: SandboxEntityType): EntityData {
  entityCounter++;
  const id = `sandbox_${type}_${entityCounter}`;
  const base = {
    id,
    name: SAMPLE_NAMES[type],
    ownerId: 'sandbox',
    createdAt: new Date(),
    updatedAt: new Date(),
    frecencyScore: 1,
  };

  switch (type) {
    case 'md':
      return { ...base, type: 'document', fileType: 'md' };
    case 'snippet':
      return {
        ...base,
        type: 'document',
        fileType: 'md',
        subType: { type: 'snippet' },
      };
    case 'canvas':
      return { ...base, type: 'document', fileType: 'canvas' };
    case 'code':
      return { ...base, type: 'document', fileType: 'py' };
    case 'task':
      return {
        ...base,
        type: 'document',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      };
    case 'email':
      return {
        ...base,
        type: 'email',
        isRead: false,
        isDraft: true,
        isImportant: false,
        done: false,
        senderEmail: 'you@example.com',
        senderName: 'You',
        snippet: '',
        participants: [],
      };
    case 'channel':
      return { ...base, type: 'channel', channelType: 'private' };
    case 'chat':
      return { ...base, type: 'chat' };
    case 'project':
      return { ...base, type: 'project' };
  }
}

export function resetSandbox() {
  entityCounter = 0;
  setEntities([...SEED_ENTITIES]);
  setSidebarFilter('empty');
}

// -- Command menu helpers --

type EntityBucketType =
  | 'note'
  | 'task'
  | 'snippet'
  | 'email'
  | 'channel'
  | 'chat'
  | 'project'
  | 'dm'
  | 'document';

function entityToBucket(entity: EntityData): EntityBucketType {
  switch (entity.type) {
    case 'document':
      if (entity.subType?.type === 'task') return 'task';
      if (entity.subType?.type === 'snippet') return 'snippet';
      return 'note';
    case 'email':
      return 'email';
    case 'channel':
      return entity.channelType === 'direct_message' ? 'dm' : 'channel';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    default:
      return 'note';
  }
}

// -- Sandbox contacts --

export const SANDBOX_USERS: IUser[] = [
  { id: 'user_1', name: 'Sarah Chen', email: 'sarah@example.com' },
  { id: 'user_2', name: 'Marcus Lee', email: 'marcus@example.com' },
  { id: 'user_3', name: 'Jordan Rivera', email: 'jordan@example.com' },
  { id: 'user_4', name: 'Alex Kim', email: 'alex@example.com' },
  { id: 'user_5', name: 'Priya Patel', email: 'priya@example.com' },
  { id: 'user_6', name: 'David Okafor', email: 'david@example.com' },
  { id: 'user_7', name: 'Emily Zhang', email: 'emily@example.com' },
  { id: 'user_8', name: 'Carlos Ruiz', email: 'carlos@example.com' },
  { id: 'user_9', name: 'Aisha Mohammed', email: 'aisha@example.com' },
  { id: 'user_10', name: 'Tom Brennan', email: 'tom@example.com' },
  { id: 'user_11', name: 'Yuki Tanaka', email: 'yuki@example.com' },
  { id: 'user_12', name: 'Fatima Al-Hassan', email: 'fatima@example.com' },
  { id: 'user_13', name: 'Liam Murphy', email: 'liam@example.com' },
  { id: 'user_14', name: 'Sofia Andersson', email: 'sofia@example.com' },
  { id: 'user_15', name: 'Raj Gupta', email: 'raj@example.com' },
];

export function sandboxToCommandItems() {
  return sandboxEntities().map((entity) => ({
    id: entity.id,
    kind: 'entity' as const,
    bucket: entityToBucket(entity),
    searchText: entity.name,
    sortTimestamp:
      entity.updatedAt instanceof Date
        ? entity.updatedAt.getTime()
        : new Date(entity.updatedAt ?? Date.now()).getTime(),
    timestamps: { updatedAt: entity.updatedAt ?? null },
    data: entity,
  }));
}
