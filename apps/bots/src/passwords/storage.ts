import type {
  PasswordItemKind,
  PasswordsCreateData,
  PasswordsDetailResponse,
  PasswordsFoldersResponse,
  PasswordsListData,
  PasswordsListResponse,
  PasswordsUpdateData,
} from '@macro-inc/sdk/generated/storage';

export const layouts = {
  login: {
    label: 'Login',
    description: 'Username, password, website, optional TOTP',
    fields: ['username', 'password', 'website', 'totp', 'notes'],
  },
  card: {
    label: 'Card',
    description: 'Cardholder, number, expiration, security code',
    fields: ['cardholder', 'cardNumber', 'expiration', 'securityCode', 'notes'],
  },
  note: {
    label: 'Secure note',
    description: 'Protected note',
    fields: ['note'],
  },
  identity: {
    label: 'Identity',
    description: 'Full name, email, phone, address',
    fields: ['fullName', 'email', 'phone', 'address', 'notes'],
  },
  api: {
    label: 'API',
    description: 'Endpoint, key, secret, environment',
    fields: ['website', 'apiKey', 'apiSecret', 'environment', 'notes'],
  },
  verification_code: {
    label: 'Verification code',
    description: 'Account and required TOTP',
    fields: ['account', 'totp'],
  },
} as const satisfies Record<
  PasswordItemKind,
  { label: string; description: string; fields: readonly string[] }
>;

export const kinds = [
  'login',
  'card',
  'note',
  'identity',
  'api',
  'verification_code',
] as const satisfies readonly PasswordItemKind[];

const publicLabels = {
  username: 'Username',
  website: 'Website',
  cardholder: 'Cardholder',
  expiration: 'Expiration',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  environment: 'Environment',
  account: 'Account',
};

const secretLabels = {
  password: 'Password',
  totp: 'Verification code (TOTP)',
  notes: 'Notes',
  note: 'Note',
  cardNumber: 'Card number',
  securityCode: 'Security code',
  apiKey: 'Key',
  apiSecret: 'Secret',
};

type PublicField = keyof typeof publicLabels;
export type SecretField = keyof typeof secretLabels;
type Field = (typeof layouts)[PasswordItemKind]['fields'][number];

export function isSecret(field: Field): field is SecretField {
  return Object.hasOwn(secretLabels, field);
}

export function fieldLabel(kind: PasswordItemKind, field: Field) {
  if (isSecret(field)) return secretLabels[field];
  return kind === 'api' && field === 'website'
    ? 'Endpoint'
    : publicLabels[field];
}

type Team = PasswordsListData['path']['team'];
type CreateBody = PasswordsCreateData['body'];
type UpdateBody = PasswordsUpdateData['body'];
export type Folder = Pick<PasswordsFoldersResponse[number], 'id' | 'name'>;
export type Item = Pick<
  PasswordsDetailResponse,
  | 'id'
  | 'teamId'
  | 'kind'
  | 'name'
  | 'folderId'
  | 'sharedWithTeam'
  | 'canEdit'
  | 'version'
> & {
  creator: string;
  agentCount: number;
  fields: Partial<Record<PublicField, string>>;
  filled: Partial<Record<SecretField, true>>;
  fixtureUseWhen?: string;
};

export type ItemSummary = Pick<
  PasswordsListResponse[number],
  'id' | 'kind' | 'name' | 'folderId'
> &
  Pick<Item, 'creator' | 'agentCount'>;

type EditDetails = Pick<UpdateBody, 'name' | 'folderId'> &
  Pick<Item, 'fields' | 'filled' | 'fixtureUseWhen'>;
export type SaveItem =
  | (EditDetails & Pick<CreateBody, 'kind' | 'private'> & { id?: never })
  | (EditDetails &
      Pick<Item, 'id'> & {
        expectedVersion: NonNullable<UpdateBody['expectedVersion']>;
      });

export type Readiness = 'ready' | 'empty' | 'incompatible' | 'recovery';

// The fixture uses generated metadata and write projections. Secret values and
// provider-specific operations have no representation at this local boundary.
export type PasswordStorage = {
  read(team: Team): {
    role: 'Team admin' | 'Team member';
    readiness: Readiness;
    canCreate: boolean;
    folders: readonly Folder[];
    items: ItemSummary[];
  };
  detail(team: Team, id: Item['id']): Item | undefined;
  save(team: Team, item: SaveItem): Item['id'] | undefined;
};
