/** Query-key factories owned by the entity feature. */
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

/**
 * Email preview views that are inbox-scoped server-side and so exclude
 * archived (done) threads. Exhaustive over PreviewViewStandardLabel: adding
 * a view label won't compile until it's classified here.
 */
const EMAIL_VIEW_EXCLUDES_DONE: Record<PreviewViewStandardLabel, boolean> = {
  inbox: true,
  important: true,
  other: true,
  all: false,
  starred: false,
  sent: false,
  drafts: false,
};

/**
 * Whether an email list query key (built by `queryKeys.email`) belongs to a
 * view that excludes done threads. Owned here because this module owns the
 * key shape: the options object is the key's final element.
 */
export function emailQueryKeyExcludesDone(key: readonly unknown[]): boolean {
  const options = key.at(-1);
  if (typeof options !== 'object' || options === null) return false;
  const view = (options as Partial<EmailKeyOptions>).view;
  return view !== undefined && EMAIL_VIEW_EXCLUDES_DONE[view] === true;
}

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
