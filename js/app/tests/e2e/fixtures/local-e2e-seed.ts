import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type SeedManifest = {
  user: {
    email: string;
  };
  documents: {
    projectRoadmap: {
      id: string;
      name: string;
    };
  };
  channels: {
    general: {
      id: string;
      name: string;
      message: string;
    };
  };
};

export type SeedUser = {
  macro_user_id: string;
  fusion_user_id: string;
  user_id: string;
  username: string;
  email: string;
  stripe_customer_id: string;
  first_name: string;
  last_name: string;
  roles: string[];
  tutorial_complete: boolean;
  has_onboarding_documents: boolean;
  has_trialed: boolean;
  is_verified: boolean;
};

export type SeedDocument = {
  document_id: string;
  document_name: string;
  file_name: string;
  is_public: boolean;
};

export type SeedChannel = {
  channel_id: string;
  channel_name?: string;
  channel_type:
    | 'public'
    | 'private'
    | 'direct_message'
    | 'organization'
    | 'team';
  participants: string[];
};

export type SeedMention = {
  entity_type: 'document' | 'user' | string;
  entity_id: string;
};

export type SeedChannelMessage = {
  message_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  thread_id?: string;
  entity_mentions?: SeedMention[];
};

function findRepoRoot(): string {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));

  while (true) {
    if (existsSync(join(current, 'rust/cloud-storage/seed_cli/seed'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error('Could not find repo root from local e2e seed fixture');
    }
    current = parent;
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(join(findRepoRoot(), relativePath), 'utf8')
  ) as T;
}

function indexBy<T>(rows: readonly T[], key: (row: T) => string | undefined) {
  const out = new Map<string, T>();
  for (const row of rows) {
    const value = key(row);
    if (value) out.set(value, row);
  }
  return out;
}

function required<T>(value: T | undefined, description: string): T {
  if (!value) throw new Error(`Missing local e2e seed fixture: ${description}`);
  return value;
}

const manifest = readJson<SeedManifest>(
  'rust/cloud-storage/seed_cli/seed/local_e2e/manifest.json'
);
const users = readJson<SeedUser[]>(
  'rust/cloud-storage/seed_cli/seed/local_e2e/users.json'
);
const documents = readJson<SeedDocument[]>(
  'rust/cloud-storage/seed_cli/seed/documents/documents.json'
);
const channels = readJson<SeedChannel[]>(
  'rust/cloud-storage/seed_cli/seed/channels.json'
);
const channelMessages = readJson<SeedChannelMessage[]>(
  'rust/cloud-storage/seed_cli/seed/channel_messages.json'
);

const usersById = indexBy(users, (row) => row.user_id);
const usersByEmail = indexBy(users, (row) => row.email);
const usersByMacroUserId = indexBy(users, (row) => row.macro_user_id);
const documentsById = indexBy(documents, (row) => row.document_id);
const documentsByName = indexBy(documents, (row) => row.document_name);
const channelsById = indexBy(channels, (row) => row.channel_id);
const channelsByName = indexBy(channels, (row) => row.channel_name);
const channelMessagesById = indexBy(channelMessages, (row) => row.message_id);

function channelMessagesByChannelId(channelId: string): SeedChannelMessage[] {
  return channelMessages.filter((message) => message.channel_id === channelId);
}

export const localE2ESeed = {
  user: required(
    usersByEmail.get(manifest.user.email),
    `user ${manifest.user.email}`
  ),
  users,
  usersById,
  usersByEmail,
  usersByMacroUserId,
  documents,
  documentsById,
  documentsByName,
  channels,
  channelsById,
  channelsByName,
  channelMessages,
  channelMessagesById,
  channelMessagesByChannelId,
  smoke: {
    user: required(
      usersByEmail.get(manifest.user.email),
      `user ${manifest.user.email}`
    ),
    projectRoadmap: required(
      documentsById.get(manifest.documents.projectRoadmap.id),
      `document ${manifest.documents.projectRoadmap.id}`
    ),
    generalChannel: required(
      channelsById.get(manifest.channels.general.id),
      `channel ${manifest.channels.general.id}`
    ),
    generalWelcomeMessage: required(
      channelMessages.find(
        (message) =>
          message.channel_id === manifest.channels.general.id &&
          message.content === manifest.channels.general.message
      ),
      `message ${manifest.channels.general.message}`
    ),
  },
} as const;
