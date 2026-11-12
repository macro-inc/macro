import { type APIRequestContext, expect, type Page } from '@playwright/test';

/** Seeded users of `crates/gmail_emulator/seed.example.yaml`. */
export const BOB = { name: 'Bob Example', email: 'bob@example.com' };
export const CAROL = { name: 'Carol Example', email: 'carol@example.com' };

const emulator = (): string => {
  const url = process.env.GMAIL_EMULATOR_URL;
  if (!url) throw new Error('GMAIL_EMULATOR_URL is required');
  return url.replace(/\/$/, '');
};

/** Signs in with Google as a seeded user, skips onboarding, opens Mail. */
export async function openMailAs(page: Page, user: { name: string }) {
  await page.goto('welcome');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('button', { name: new RegExp(user.name) }).click();
  const bypass = page.getByRole('button', { name: 'Bypass' });
  const home = page.getByRole('button', { name: 'Home' });
  // Signed in: onboarding or the app is showing.
  await expect(bypass.or(home).first()).toBeVisible({ timeout: 60_000 });
  // Until onboarding is done the app shows it in place of Mail, so Mail's
  // grid or onboarding's Bypass is the final state.
  await page.goto('component/mail');
  const grid = page.getByRole('grid', { name: 'Email' });
  await expect(grid.or(bypass).first()).toBeVisible({ timeout: 60_000 });
  if (await bypass.isVisible()) {
    await bypass.click();
    await expect(page).not.toHaveURL(/\/(welcome|onboarding)/, {
      timeout: 30_000,
    });
    await page.goto('component/mail');
    await expect(grid).toBeVisible({ timeout: 60_000 });
  }
}

/** Mail arrives in a user's Gmail; Gmail pushes the change to Macro. */
export async function deliver(
  request: APIRequestContext,
  to: { email: string },
  mail: { from: string; subject: string; text: string }
) {
  const response = await request.post(
    `${emulator()}/_emulator/mailboxes/${to.email}/messages`,
    { data: mail }
  );
  expect(response.ok()).toBe(true);
}

type Message = { subject?: string; labels: string[] };

async function messagesIn(
  request: APIRequestContext,
  user: { email: string }
): Promise<Message[]> {
  const response = await request.get(
    `${emulator()}/_emulator/mailboxes/${user.email}/messages`
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

/** The subjects in a user's Gmail. */
export async function subjectsIn(
  request: APIRequestContext,
  user: { email: string }
): Promise<string[]> {
  return (await messagesIn(request, user)).flatMap((message) =>
    message.subject ? [message.subject] : []
  );
}

/** The subjects of the drafts in a user's Gmail. */
export async function draftsIn(
  request: APIRequestContext,
  user: { email: string }
): Promise<string[]> {
  return (await messagesIn(request, user))
    .filter((message) => message.labels.includes('DRAFT'))
    .map((message) => message.subject ?? '');
}

export function uniqueSubject(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
