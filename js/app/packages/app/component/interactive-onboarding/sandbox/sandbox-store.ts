import type { EntityData } from '@entity';
import type { IUser } from '@core/user/types';
import {
  MOCK_DOCUMENT_BASIC,
  MOCK_EMAIL_UNREAD,
  MOCK_TASK_TODO,
  MOCK_CHANNEL_PUBLIC,
  MOCK_PROJECT_1,
} from '../../../../entity/mocks/mockEntityData';
import { createSignal } from 'solid-js';

const now = new Date();

function seedDoc(id: string, name: string, fileType = 'md'): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType,
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}
function seedTask(id: string, name: string): EntityData {
  return {
    type: 'document',
    id,
    name,
    ownerId: 'sandbox',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}
function seedEmail(
  id: string,
  name: string,
  senderName: string,
  senderEmail: string
): EntityData {
  return {
    type: 'email',
    id,
    name,
    ownerId: 'sandbox',
    isRead: false,
    isDraft: false,
    isImportant: false,
    done: false,
    senderEmail,
    senderName,
    snippet: '',
    participants: [],
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}
function seedChannel(id: string, name: string): EntityData {
  return {
    type: 'channel',
    id,
    name,
    ownerId: 'sandbox',
    channelType: 'public',
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}
function seedProject(id: string, name: string): EntityData {
  return {
    type: 'project',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}
function seedChat(id: string, name: string): EntityData {
  return {
    type: 'chat',
    id,
    name,
    ownerId: 'sandbox',
    createdAt: now,
    updatedAt: now,
    frecencyScore: 1,
  };
}

const SEED_ENTITIES: EntityData[] = [
  MOCK_PROJECT_1,
  seedDoc('seed_doc_1', 'Q3 Product Roadmap'),
  seedTask('seed_task_1', 'Review design mockups'),
  seedEmail(
    'seed_email_1',
    'Re: Launch checklist',
    'Sarah Chen',
    'sarah@example.com'
  ),
  seedChannel('seed_channel_1', 'engineering'),
  seedDoc('seed_doc_2', 'Architecture Decision Record'),
  seedTask('seed_task_2', 'Write release notes'),
  seedProject('seed_project_2', 'Website Redesign'),
  seedChat('seed_chat_1', 'Brainstorm: onboarding flow'),
  seedEmail(
    'seed_email_2',
    'Budget approval needed',
    'Marcus Lee',
    'marcus@example.com'
  ),
  seedDoc('seed_doc_3', 'Meeting Notes — All Hands'),
  seedTask('seed_task_3', 'Set up CI pipeline'),
  seedChannel('seed_channel_2', 'design'),
  seedDoc('seed_doc_4', 'Customer Interview Summary', 'canvas'),
  seedEmail(
    'seed_email_3',
    'Investor update Q3',
    'Jordan Rivera',
    'jordan@example.com'
  ),
  seedTask('seed_task_4', 'Fix login page regression'),
  seedProject('seed_project_3', 'Mobile App v2'),
  seedDoc('seed_doc_5', 'API Reference', 'py'),
  seedChat('seed_chat_2', 'Draft: pricing page copy'),
  seedChannel('seed_channel_3', 'announcements'),
  seedEmail(
    'seed_email_4',
    'Contract renewal — action required',
    'Alex Kim',
    'alex@example.com'
  ),
  seedTask('seed_task_5', 'Update dependencies'),
  seedDoc('seed_doc_6', 'Brand Guidelines'),
  seedTask('seed_task_6', 'Schedule user research sessions'),
  MOCK_DOCUMENT_BASIC,
  MOCK_EMAIL_UNREAD,
  MOCK_TASK_TODO,
  MOCK_CHANNEL_PUBLIC,
];

const [entities, setEntities] = createSignal<EntityData[]>([...SEED_ENTITIES]);

let entityCounter = 0;

export function sandboxEntities() {
  return entities();
}

export function addSandboxEntity(entity: EntityData) {
  setEntities((prev) => [entity, ...prev]);
}

export type SandboxEntityType =
  | 'md'
  | 'email'
  | 'task'
  | 'channel'
  | 'chat'
  | 'canvas'
  | 'project'
  | 'code';

const SAMPLE_NAMES: Record<SandboxEntityType, string> = {
  md: 'My Sample Document',
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
      return { ...base, type: 'channel', channelType: 'public' };
    case 'chat':
      return { ...base, type: 'chat' };
    case 'project':
      return { ...base, type: 'project' };
  }
}

export function resetSandbox() {
  entityCounter = 0;
  setEntities([...SEED_ENTITIES]);
}

// -- Command menu helpers --

type EntityBucketType =
  | 'note'
  | 'task'
  | 'email'
  | 'channel'
  | 'chat'
  | 'project'
  | 'dm'
  | 'document';

function entityToBucket(entity: EntityData): EntityBucketType {
  switch (entity.type) {
    case 'document':
      return entity.subType?.type === 'task' ? 'task' : 'note';
    case 'email':
      return 'email';
    case 'channel':
      return 'channel';
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
