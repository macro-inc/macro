// Tags, properties and reminders of a thread: what the storage service
// holds, and the set-up a test of them needs.

import type { Mailbox } from './fixtures';
import { localStackAddresses } from './local-stack';

const JSON_BODY = { 'content-type': 'application/json' };

async function answered<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${what} answered ${response.status}:\n${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A tag the user can put on a thread. */
export type Tag = { definitionId: string; optionId: string; name: string };

/** Creates a tag in the user's own tag set, as the Create tag dialog does. */
export async function createTag(mailbox: Mailbox, name: string): Promise<Tag> {
  const set = await answered<{
    definition: { id: string };
    options: unknown[];
  }>(
    await mailbox.api('/dss/properties/tags', {
      method: 'POST',
      headers: JSON_BODY,
      body: JSON.stringify({ scope: 'user' }),
    }),
    'the tag set'
  );
  const option = await answered<{ id: string }>(
    await mailbox.api(
      `/dss/properties/definitions/${set.definition.id}/options`,
      {
        method: 'POST',
        headers: JSON_BODY,
        body: JSON.stringify({
          type: 'select_string',
          option: {
            value: name,
            color: '#3B82F6',
            display_order: set.options.length,
          },
        }),
      }
    ),
    'creating the tag'
  );
  return { definitionId: set.definition.id, optionId: option.id, name };
}

/** Puts a tag on a thread without the app. */
export async function tagThread(
  mailbox: Mailbox,
  threadId: string,
  tag: Tag
): Promise<void> {
  await answered(
    await mailbox.api(
      `/dss/properties/entities/THREAD/${threadId}/${tag.definitionId}/options/${tag.optionId}`,
      { method: 'POST' }
    ),
    'tagging the thread'
  );
}

/** A property of a thread as the storage service holds it. */
export type ThreadProperty = {
  definition: { display_name: string; data_type: string };
  value: { type: string; value: unknown } | null;
  options?: { id: string; value?: unknown }[] | null;
  [field: string]: unknown;
};

/** The properties the storage service holds for a thread. */
export async function threadProperties(
  mailbox: Mailbox,
  threadId: string
): Promise<ThreadProperty[]> {
  const body = await answered<{ properties: ThreadProperty[] }>(
    await mailbox.api(`/dss/properties/entities/THREAD/${threadId}`),
    'the properties of the thread'
  );
  return body.properties;
}

/** The ids of the tags the storage service holds on a thread. */
export async function threadTagIds(
  mailbox: Mailbox,
  threadId: string
): Promise<string[]> {
  const tags = (await threadProperties(mailbox, threadId)).find(
    (property) => property.definition.data_type === 'TAG'
  );
  return Array.isArray(tags?.value?.value)
    ? (tags.value.value as string[])
    : [];
}

/** A thread's reminder as the storage service holds it. */
export type Followup = {
  threadId: string;
  state: string;
  remindAt: string;
  condition: 'if_no_reply' | 'regardless';
  revision: string;
};

/** The reminder of a thread, or nothing when it never had one. */
export async function followup(
  mailbox: Mailbox,
  threadId: string
): Promise<Followup | undefined> {
  const body = await answered<{ followup: Followup | null }>(
    await mailbox.api(`/dss/reminders/email/${threadId}`),
    'the reminder of the thread'
  );
  return body.followup ?? undefined;
}

/** The threads the Reminders tab lists, with their reminders. */
export async function pendingFollowups(mailbox: Mailbox): Promise<Followup[]> {
  const body = await answered<{
    items: { threadId: string; followup: Omit<Followup, 'threadId'> }[];
  }>(
    await mailbox.api('/dss/reminders/email/collection'),
    'the reminders of the user'
  );
  return body.items.map((item) => ({
    ...item.followup,
    threadId: item.threadId,
  }));
}

/** Sets a reminder on a thread without the app. */
export async function setFollowup(
  mailbox: Mailbox,
  threadId: string,
  remindAt: Date,
  condition: Followup['condition']
): Promise<void> {
  await answered(
    await mailbox.api(`/dss/reminders/email/${threadId}`, {
      method: 'PUT',
      headers: JSON_BODY,
      body: JSON.stringify({
        type: 'set',
        remindAt: remindAt.toISOString(),
        condition,
        operationId: crypto.randomUUID(),
      }),
    }),
    'setting the reminder'
  );
}

/**
 * Plays the scheduler's minutely tick: puts the sweep message on the stack's
 * reminder dispatch queue, which is what makes the storage service look at
 * pending reminders again (deliver the due ones, cancel the answered ones).
 * Nothing in the per-test stack sends it otherwise.
 */
export async function tickReminders(mailbox: Mailbox): Promise<void> {
  // The local stack has one queue, which every test's reminders share: a
  // tick there looks at all of them, and each belongs to its own user.
  const local = localStackAddresses();
  if (local) {
    if (!local.sqsUrl)
      throw new Error(
        "EMAIL_E2E_STACK_SQS_URL is not set: the address of the stack's LocalStack"
      );
    return sendSweep(`${local.sqsUrl}/000000000000/reminder-dispatch-queue`);
  }
  const sqs = process.env.EMAIL_E2E_SQS_URL;
  if (!sqs) throw new Error('EMAIL_E2E_SQS_URL is not set');
  // The stack's queues are named after its own id, of which the test only
  // knows the end: the log directory is `<name>-<last 8 of the id>`.
  const suffix = mailbox.stack.info.logDir.slice(-8);
  const queues = await (
    await fetch(`${sqs}/?Action=ListQueues&Version=2012-11-05`)
  ).text();
  const queue = queues.match(
    new RegExp(
      `<QueueUrl>([^<]*/e2e-[0-9a-f]{24}${suffix}-reminder-dispatch)</QueueUrl>`
    )
  )?.[1];
  if (!queue)
    throw new Error(`no reminder dispatch queue of the stack ...${suffix}`);
  await sendSweep(queue);
}

async function sendSweep(queue: string): Promise<void> {
  const sent = await fetch(queue, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      Action: 'SendMessage',
      Version: '2012-11-05',
      MessageBody: JSON.stringify({ operation: 'sweep' }),
    }),
  });
  if (!sent.ok)
    throw new Error(
      `the sweep message was refused: ${sent.status}\n${await sent.text()}`
    );
}

/**
 * Makes the pending reminder of a thread due a minute ago, in the stack's
 * database: the service refuses a time that has passed, and no test can wait
 * for tomorrow. Both places that hold the time move together, the reminder's
 * own record first, so a tick in between finds nothing due. Answers the time.
 */
export async function makeFollowupDue(
  mailbox: Mailbox,
  threadId: string
): Promise<Date> {
  // To the second: the two records must hold the very same time.
  const due = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  const mine = `user_id = '${mailbox.user.macroUserId}' AND thread_id = '${threadId}' AND state = 'pending'`;
  const records = await mailbox.stack.sql(
    `UPDATE reminder_email_followup
     SET payload = jsonb_set(payload, '{followup,remindAt}', to_jsonb('${due.toISOString()}'::text))
     WHERE ${mine} RETURNING reminder_id`
  );
  if (records.length !== 1)
    throw new Error(`${records.length} pending reminders on ${threadId}`);
  await mailbox.stack.sql(
    `UPDATE reminder SET remind_at = '${due.toISOString()}', next_run_at = '${due.toISOString()}'
     WHERE id IN (SELECT reminder_id FROM reminder_email_followup WHERE ${mine})
     RETURNING id`
  );
  return due;
}
