import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import type { PaginatedSearchArgs } from '@service-search/client';
import { hashKey } from '@tanstack/solid-query';

const BASE_AUTH = ['auth'];

const ENTITY = 'entity';
const BASE_ENTITY = {
  entity: [ENTITY],
  channel: [ENTITY, 'channel'],
  dss: [ENTITY, 'dss'],
  email: [ENTITY, 'email'],
  notification: [ENTITY, 'notification'],
  search: [ENTITY, 'search'],
};

type KeyOptions = {
  id?: string;
  ids?: string[];
  [key: string]: string | string[] | boolean | number | undefined;
};
type InfiniteKeyOptions =
  | KeyOptions
  | (KeyOptions & {
      infinite: true;
      limit: number;
    });
type EmailKeyOptions = InfiniteKeyOptions & {
  view: PreviewViewStandardLabel;
};
type NotificationKeyOptions = InfiniteKeyOptions & {
  eventItemId?: string;
  eventItemIds?: string[];
};
type SearchKeyOptions = {
  infinite: true;
} & PaginatedSearchArgs;

export const queryKeys = {
  all: {
    ...BASE_ENTITY,
    auth: BASE_AUTH,
  },
  auth: {
    apiToken: [...BASE_AUTH, 'api-token'],
    profilePicture: (args: KeyOptions) => [
      ...BASE_AUTH,
      'profile-picture',
      { ...args },
    ],
  },
  channel: (args: KeyOptions) => [...BASE_ENTITY.channel, { ...args }],
  chat: (args?: InfiniteKeyOptions) => [
    ...BASE_ENTITY.dss,
    { type: 'chat', ...args },
  ],
  document: (args?: InfiniteKeyOptions) => [
    ...BASE_ENTITY.dss,
    { type: 'document', ...args },
  ],
  dss: (args?: InfiniteKeyOptions) => [...BASE_ENTITY.dss, { ...args }],
  email: (args: EmailKeyOptions) => [...BASE_ENTITY.email, { ...args }],
  notification: (args?: NotificationKeyOptions) => [
    ...BASE_ENTITY.notification,
    { ...args },
  ],
  project: (args: { projectId: string }) => [
    'project',
    { projectId: args.projectId },
  ],
  search: (args: SearchKeyOptions) => [...BASE_ENTITY.search, { ...args }],
};

export type DssQueryKey = [
  (typeof BASE_ENTITY.dss)[0],
  (typeof BASE_ENTITY.dss)[1],
  { type: 'chat' | 'document' } & InfiniteKeyOptions,
  ...string[],
];
export function dssQueryKeyHashFn(queryKey: DssQueryKey): string {
  try {
    const [, , { type: _, ...options }, ...additional] = queryKey;
    const hashedKey = hashKey([options, ...additional]);

    return `dss-entity|${hashedKey}`;
  } catch (error) {
    console.error('Error hashing DSS query key', error);
    return hashKey(queryKey);
  }
}
