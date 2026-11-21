import type { Page } from 'playwright';
import { pageLoad, pendingRequests } from './inflight';

/**
 * Opens the app signed in. The driver gives each browser context the cookies
 * of its own passwordless sign-in (lib/api.ts), so the app restores that
 * session; without them it signs in through the email form, where the local
 * stack returns the code and the app verifies it itself
 * (docs/agent-guide/login.md). Onboarding is left as it is: finishing it would
 * change the user's state.
 */
export async function login(page: Page, origin: string, email: string) {
  // What the page threw while opening, for the error if it never does.
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(String(e).slice(0, 160));
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    await pageLoad(() => signIn(page, origin, email));
  } catch (error) {
    throw new Error(`${String(error).slice(0, 600)}; page errors: ${errors.slice(-4).join(' | ') || 'none'}`);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
}

async function signIn(page: Page, origin: string, email: string) {
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' });
  const emailButton = page.getByRole('button', { name: 'Continue with email' });
  // Now and then a dev-server page never renders (a blank body for minutes,
  // while the same page opens in seconds on a reload): reload it, up to four
  // times, before giving up.
  let deadline = Date.now() + 75_000;
  for (let reloads = 0; ; ) {
    if (Date.now() >= deadline) {
      if (reloads++ >= 4) break;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      deadline = Date.now() + 75_000;
    }
    if (await emailButton.isVisible().catch(() => false)) break;
    const signedIn = await page
      .evaluate(async () => {
        const booted = (document.body?.innerText ?? '').trim().length > 0;
        if (!booted) return false;
        const r = await fetch('/auth/team/user', { credentials: 'include' });
        return r.ok;
      })
      .catch(() => false);
    if (signedIn) return;
    await page.waitForTimeout(500);
  }
  if (!(await emailButton.isVisible().catch(() => false))) {
    const text = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 300)).catch((e) => `evaluate failed: ${e}`);
    throw new Error(`app did not open signed in or at sign-in: ${page.url()} shows ${JSON.stringify(text)}; open requests: ${pendingRequests(page).join(', ') || 'none'}`);
  }
  const verified = page.waitForResponse(
    (r) => r.url().includes('/auth/oauth/passwordless/') && r.status() === 200,
    { timeout: 60_000 }
  );
  // The sign-in form's email field (its placeholder is an example address).
  const field = page.getByPlaceholder(/^you@/);
  for (let i = 0; i < 5 && !(await field.isVisible()); i++) {
    await emailButton.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await field.fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await verified;
}
