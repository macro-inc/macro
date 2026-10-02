import { z } from 'zod';

/** Browser-owned subset of the effective limits in SLACK_ARCHIVE_IMPORT_CONTRACT.md. */
export type ArchiveLimits = {
  jsonBytes: number;
  selectedBytes: number;
  zipEntries: number;
  conversations: number;
};

export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = {
  jsonBytes: 32 * 1024 * 1024,
  selectedBytes: 2 * 1024 * 1024 * 1024,
  zipEntries: 100_000,
  conversations: 2_000,
};

export type ArchiveErrorCode =
  | 'invalid_zip'
  | 'unsupported_zip'
  | 'unsafe_path'
  | 'duplicate_entry'
  | 'missing_metadata'
  | 'invalid_metadata'
  | 'ambiguous_folder'
  | 'unresolved_folder'
  | 'invalid_json'
  | 'json_limit'
  | 'compressed_limit'
  | 'selected_limit'
  | 'entry_limit'
  | 'invalid_selection'
  | 'cancelled'
  | 'invalid_state'
  | 'invalid_message'
  | 'record_limit'
  | 'storage_quota'
  | 'storage_unavailable';

const ERROR_MESSAGES: Record<ArchiveErrorCode, string> = {
  invalid_zip: 'The ZIP is damaged or inconsistent.',
  unsupported_zip:
    'Only single-volume, unencrypted ZIPs using Store or Deflate are supported; ZIP64 is not supported.',
  unsafe_path: 'The ZIP contains an unsafe path.',
  duplicate_entry: 'The ZIP contains duplicate entry paths.',
  missing_metadata:
    'The archive requires users.json or org_users.json and conversation metadata at its root.',
  invalid_metadata: 'Slack metadata is invalid or conflicting.',
  ambiguous_folder:
    'More than one metadata entry or folder matches a conversation.',
  unresolved_folder:
    'A history folder cannot be resolved through Slack metadata.',
  invalid_json: 'A metadata or day file is not a valid JSON array of objects.',
  json_limit:
    'A users, metadata or day JSON file exceeds the configured expanded-byte limit (32 MiB by default).',
  compressed_limit:
    'A JSON entry exceeds the compressed-byte safety limit (twice the JSON limit plus 64 KiB).',
  selected_limit:
    'Selected expanded data exceeds the configured byte limit (2 GiB by default).',
  entry_limit: 'The ZIP exceeds the configured entry limit.',
  invalid_selection:
    'Select a nonempty, unique set of known conversations within the configured limit.',
  cancelled: 'Archive reading was cancelled.',
  invalid_state: 'The archive operation is not valid in the current state.',
  invalid_message: 'A Slack message has invalid fields or timestamps.',
  record_limit: 'A normalized message exceeds the record or part byte limit.',
  storage_quota:
    'Browser storage is full. Free disk space and retry the archive.',
  storage_unavailable:
    'Temporary browser storage is unavailable. Retry in a browser with IndexedDB enabled.',
};

export class ArchiveError extends Error {
  constructor(public readonly code: ArchiveErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ArchiveError';
  }
}

export function validateArchiveLimits(limits: ArchiveLimits): void {
  if (Object.values(limits).some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    throw new ArchiveError('invalid_metadata');
  }
}

export function isSafeSegment(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ZIP paths must reject control characters.
  const unsafe = /[\\/%\u0000-\u001f\u007f:]/;
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !unsafe.test(value) &&
    new TextEncoder().encode(value).length <= 255
  );
}

export function validateArchivePath(path: string): void {
  const segments = path.replace(/\/$/, '').split('/');
  if (
    new TextEncoder().encode(path).length > 1024 ||
    !segments.every(isSafeSegment)
  ) {
    throw new ArchiveError('unsafe_path');
  }
}

export const CONVERSATION_FILES = {
  'channels.json': 'public_channel',
  'groups.json': 'private_channel',
  'dms.json': 'direct_message',
  'mpims.json': 'group_direct_message',
} as const;

export type ConversationKind =
  (typeof CONVERSATION_FILES)[keyof typeof CONVERSATION_FILES];
export type ConversationMetadata = {
  slackChannelId: string;
  kind: ConversationKind;
  name: string;
  folder: string;
  memberIds: string[];
  creatorId: string | null;
  createdAt: string | null;
  archived: boolean;
  /** Discovery never inflates day files to count messages. */
  messageCount: null;
};

const userId = z.string().regex(/^[UW][A-Z0-9]{1,63}$/);
const profile = z.object({
  email: z.string().nullable().default(null),
  display_name: z.string().nullable().default(null),
  real_name: z.string().nullable().default(null),
});
const user = z.object({
  id: userId,
  name: z.string().nullable().default(null),
  real_name: z.string().nullable().default(null),
  profile: profile.nullable().default(null),
  is_bot: z.boolean().default(false),
});
export type ExportUser = z.infer<typeof user>;

const conversation = z.object({
  id: z.string().regex(/^[CGD][A-Z0-9]{1,63}$/),
  name: z.string().nullable().default(null),
  members: z.array(userId),
  creator: userId.nullable().default(null),
  created: z
    .union([z.number().int().nonnegative().max(253402300799), z.string()])
    .nullable()
    .default(null),
  is_archived: z.boolean().default(false),
  // Some export tools preserve explicit folder/previous-name metadata after renaming.
  folder: z.string().optional(),
  previous_names: z.array(z.string()).default([]),
});

export type ArchiveDiscovery = {
  /** Unknown is not the administrator's affirmative confirmed_unknown consent. */
  source: { kind: 'known'; sourceId: string } | { kind: 'unknown' };
  conversations: ConversationMetadata[];
  users: ExportUser[];
  dayEntries: { path: string; slackChannelId: string }[];
};

export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ArchiveError('invalid_json');
  }
}

export function parseDay(bytes: Uint8Array): Record<string, unknown>[] {
  const value = parseJson(bytes);
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
    )
  ) {
    throw new ArchiveError('invalid_json');
  }
  return value;
}

function creationTime(value: string | number | null): string | null {
  if (value === null) return null;
  const parts = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!parts || BigInt(parts[1]) > 253402300799n)
    throw new ArchiveError('invalid_metadata');
  return `${BigInt(parts[1])}.${(parts[2] ?? '').padEnd(6, '0')}`;
}

function parseUsers(roots: ReadonlyMap<string, unknown>): ExportUser[] {
  const users = new Map<string, ExportUser>();
  if (!roots.has('users.json') && !roots.has('org_users.json'))
    throw new ArchiveError('missing_metadata');
  for (const file of ['users.json', 'org_users.json']) {
    if (!roots.has(file)) continue;
    const parsed = z.array(user).safeParse(roots.get(file));
    if (!parsed.success) throw new ArchiveError('invalid_metadata');
    for (const item of parsed.data) {
      const existing = users.get(item.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item))
        throw new ArchiveError('invalid_metadata');
      users.set(item.id, item);
    }
  }
  return [...users.values()];
}

/** Pure metadata resolution. Never guess from message bodies or a user's team_id. */
export function resolveExport(
  roots: ReadonlyMap<string, unknown>,
  dayPaths: string[]
): ArchiveDiscovery {
  const users = parseUsers(roots);
  const folders = new Set(dayPaths.map((path) => path.split('/')[0]));
  const conversations: ConversationMetadata[] = [];
  const ids = new Set<string>();
  const folderOwners = new Map<string, string>();
  let foundMetadata = false;
  for (const [file, kind] of Object.entries(CONVERSATION_FILES)) {
    if (!roots.has(file)) continue;
    foundMetadata = true;
    const parsed = z.array(conversation).safeParse(roots.get(file));
    if (!parsed.success) throw new ArchiveError('invalid_metadata');
    for (const item of parsed.data) {
      if (ids.has(item.id)) throw new ArchiveError('invalid_metadata');
      ids.add(item.id);
      const aliases = new Set(
        [item.id, item.name, item.folder, ...item.previous_names].filter(
          (name): name is string => name != null
        )
      );
      if (![...aliases].every(isSafeSegment))
        throw new ArchiveError('unsafe_path');
      const matches = [...aliases].filter((alias) => folders.has(alias));
      if (matches.length > 1) throw new ArchiveError('ambiguous_folder');
      const folder = matches[0] ?? item.folder ?? item.name ?? item.id;
      if (folderOwners.has(folder)) throw new ArchiveError('ambiguous_folder');
      folderOwners.set(folder, item.id);
      conversations.push({
        slackChannelId: item.id,
        kind,
        name: item.name ?? item.id,
        folder,
        memberIds: item.members,
        creatorId: item.creator,
        createdAt: creationTime(item.created),
        archived: item.is_archived,
        messageCount: null,
      });
    }
  }
  if (!foundMetadata) throw new ArchiveError('missing_metadata');
  const dayEntries = dayPaths.map((path) => {
    const slackChannelId = folderOwners.get(path.split('/')[0]);
    if (!slackChannelId) throw new ArchiveError('unresolved_folder');
    return { path, slackChannelId };
  });
  let source: ArchiveDiscovery['source'] = { kind: 'unknown' };
  if (roots.has('team.json')) {
    const team = z
      .object({ id: z.string().regex(/^T[A-Z0-9]{1,63}$/) })
      .safeParse(roots.get('team.json'));
    if (!team.success) throw new ArchiveError('invalid_metadata');
    source = { kind: 'known', sourceId: team.data.id };
  }
  return { source, conversations, users, dayEntries };
}
