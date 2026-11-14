// Sharing a thread between two people of one stack: another person's
// threads, a grant of access, and the storage service's sharing API.
//
// The front signs every request as the gateway does for a service: with the
// internal key and the user's id. The storage service's sharing API
// (`/entities/...`: the people a thread is shared with, and requests for
// access) answers only a person's own credential, so here the page's calls
// to it go to the service with an API key of the signed-in user.

import type { Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';
import type { SignedInUser } from './front';

/** An API key of the user, as the storage service stores one. */
export async function apiKey(
  mailbox: Mailbox,
  user: SignedInUser
): Promise<string> {
  const key = `e2e-key-${user.email}`;
  await mailbox.stack.sql(
    `INSERT INTO "UserApiKey" (id, name, hash, user_id)
     VALUES (gen_random_uuid(), 'e2e', sha256('${key}'::bytea), '${user.macroUserId}')
     RETURNING id`
  );
  return key;
}

/** Asks the storage service's sharing API about a thread, with a person's key. */
export function sharingApi(
  mailbox: Mailbox,
  key: string,
  threadId: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(
    `${mailbox.stack.info.documentStorageUrl}/entities/email_thread/${threadId}/${path}`,
    {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-macro-user-api-key': key,
      },
    }
  );
}

/** Sends the page's sharing calls to the storage service as the signed-in user. */
export async function answerSharingAsUser(
  page: Page,
  mailbox: Mailbox
): Promise<void> {
  const key = await apiKey(mailbox, mailbox.user);
  const base = mailbox.stack.info.documentStorageUrl;
  await page.route(/\/dss\/entities\//, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${base}${url.pathname.slice('/dss'.length)}${url.search}`,
      headers: {
        'content-type': 'application/json',
        'x-macro-user-api-key': key,
      },
    });
    await route.fulfill({ response });
  });
}

/** Grants a person view access to a thread, as a share with them does. */
export async function grantView(
  mailbox: Mailbox,
  threadId: string,
  user: SignedInUser
): Promise<void> {
  await mailbox.stack.sql(
    `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
     VALUES ('${threadId}'::uuid, 'email_thread', '${user.macroUserId}', 'user', 'view')
     RETURNING entity_id`
  );
}

/** The status the email service answers when the person asks for a thread. */
export async function readStatus(
  mailbox: Mailbox,
  user: SignedInUser,
  threadId: string
): Promise<number> {
  const response = await fetch(
    `${mailbox.stack.info.emailUrl}/email/threads/${threadId}?limit=1`,
    {
      headers: {
        'x-internal-auth-key': mailbox.stack.info.internalApiKey,
        'x-internal-macro-user-id': user.macroUserId,
        'x-internal-fusionauth-user-id': user.fusionUserId,
      },
    }
  );
  return response.status;
}

/** The id of the one thread in the inbox of another person of the stack. */
export async function threadOf(
  mailbox: Mailbox,
  address: string
): Promise<string> {
  let threads: { id: string }[] = [];
  await expect
    .poll(
      async () => {
        threads = await mailbox.stack.sql<{ id: string }>(
          `SELECT t.id FROM email_threads t
           JOIN email_links l ON l.id = t.link_id
           WHERE l.email_address = '${address}'`
        );
        return threads.length;
      },
      { timeout: 60_000 }
    )
    .toBe(1);
  return threads[0].id;
}
