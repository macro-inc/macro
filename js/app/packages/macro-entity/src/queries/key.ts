import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import type { SearchArgs } from '@service-search/client';

const BASE_AUTH = ['auth'];

const ENTITY = 'entity';
const BASE_ENTITY = {
  entity: [ENTITY],
  dss: [ENTITY, 'dss'],
  email: [ENTITY, 'email'],
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
type SearchKeyOptions = {
  infinite: true;
} & SearchArgs;

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
  project: (args: { projectId: string }) => [
    'project',
    { projectId: args.projectId },
  ],
  search: (args: SearchKeyOptions) => [...BASE_ENTITY.search, { ...args }],
};
