import type { Link } from '../../../src/lib/service-clients/service-email/generated/schemas/link';
import { accounts, EMAIL, identity, USER_ID } from './mail';

const link: Link = {
  id: accounts[0].id,
  macro_id: USER_ID,
  email_address: EMAIL,
  fusionauth_user_id: 'fixture-user',
  is_primary: true,
  provider: 'GMAIL',
  is_sync_active: true,
  sync_status: 'UP_TO_DATE',
  needs_reauth: false,
  needs_calendar_permission: false,
  calendar_disabled: false,
  has_calendar_data: false,
  photo_url: null,
  settings: { signature: null },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};
const name = { id: USER_ID, first_name: 'Offline', last_name: 'Fixture' };

/** Empty, unrelated app-chrome resources. Unlisted requests remain errors. */
export const bootstrapResponses = new Map<
  string,
  { body: unknown; status?: number }
>([
  ['GET /auth/user/legacy_user_permissions', { body: identity }],
  ['GET /auth/user/me', { body: { user_id: USER_ID, permissions: [] } }],
  ['GET /auth/user/name', { body: name }],
  ['POST /auth/user/get_names_with_email', { body: { names: [name] } }],
  ['POST /auth/user/profile_pictures', { body: { pictures: [] } }],
  ['GET /auth/team', { body: {}, status: 404 }],
  ['GET /auth/team/user/invites', { body: { invites: [] } }],
  [
    'GET /auth/link/github/status',
    { body: { reauthentication_required: false } },
  ],
  ['GET /email/email/links', { body: { links: [link] } }],
  ['POST /email/email/links/health-check', { body: {} }],
  ['GET /contacts/contacts', { body: { contacts: [] } }],
  ['GET /dss/comms/channels', { body: { items: [], next_cursor: null } }],
  ['GET /dss/channels/activity', { body: [] }],
  ['GET /dss/bots', { body: [] }],
  ['GET /dss/properties/definitions', { body: [] }],
  ['GET /dss/properties/tags', { body: [] }],
  ['GET /dss/call/active', { body: { calls: [] } }],
  ['GET /dss/instructions', { body: {}, status: 404 }],
  ['GET /dss/crm/settings', { body: {}, status: 403 }],
  ['GET /notification/unsubscribe', { body: [] }],
  ['POST /dss/items/soup', { body: { items: [], next_cursor: null } }],
  ['POST /dss/items/soup/ast', { body: { items: [], next_cursor: null } }],
]);
