import type { EntityData } from '@entity';
import {
  MOCK_DOCUMENT_BASIC,
  MOCK_EMAIL_UNREAD,
  MOCK_TASK_TODO,
  MOCK_CHANNEL_PUBLIC,
  MOCK_PROJECT_1,
} from '../../../../entity/mocks/mockEntityData';
import { createSignal } from 'solid-js';

const SEED_ENTITIES: EntityData[] = [
  MOCK_DOCUMENT_BASIC,
  MOCK_EMAIL_UNREAD,
  MOCK_TASK_TODO,
  MOCK_CHANNEL_PUBLIC,
  MOCK_PROJECT_1,
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
