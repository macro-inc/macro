const { chromium, expect, devices } = require(
  process.cwd() + '/node_modules/@playwright/test'
);
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
const manifest = JSON.parse(fs.readFileSync(output + '/manifest.json'));
const origin = process.env.EMAIL_REVIEW_ORIGIN || 'http://localhost:24710';
for (const url of [
  origin,
  process.env.EMAIL_REVIEW_API || 'http://localhost:24709',
  process.env.EMAIL_REVIEW_CDP || 'http://localhost:9222',
]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
    throw new Error(
      'Email review requires loopback-only app and Chrome endpoints'
    );
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const sourceDiffHash = crypto
  .createHash('sha256')
  .update(execFileSync('git', ['diff', '--', 'apps/web/src']))
  .digest('hex');
const runId = new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(output + '/video', { recursive: true });
fs.mkdirSync(output + '/artifacts', { recursive: true });
const resultPath = output + '/results.json';
const results =
  process.env.EMAIL_REVIEW_APPEND === '1' && fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath))
    : [];
async function run(chapters) {
  const browser = await chromium.connectOverCDP(
    process.env.EMAIL_REVIEW_CDP || 'http://localhost:9222'
  );
  const scene = async (name, description, fn, options = {}) => {
    if (
      process.env.EMAIL_REVIEW_SCENES &&
      !process.env.EMAIL_REVIEW_SCENES.split(',').some((prefix) =>
        name.startsWith(prefix)
      )
    )
      return;
    const context = await browser.newContext({
      storageState: `${output}/${options.user || 'alex'}-auth.json`,
      ...(options.mobile
        ? devices['iPhone 13']
        : { viewport: { width: 1440, height: 1000 } }),
      colorScheme: options.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await context.addInitScript(
      (theme) =>
        localStorage.setItem('macro-theme-mode', JSON.stringify(theme)),
      options.dark ? 'dark' : 'light'
    );
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(60000);
    await page.bringToFront();
    const result = {
      revision,
      sourceDiffHash,
      runId,
      name,
      description,
      evidence:
        (options.evidence || 'Real local API and seeded database') +
        '; seeded account health held healthy; local storage URLs translated',
      steps: [],
      errors: [],
      httpErrors: [],
      responses: [],
      started: new Date().toISOString(),
    };
    const prior = results.findIndex((x) => x.name === name);
    if (prior >= 0) results.splice(prior, 1);
    results.push(result);
    const writes = [];
    page.on('pageerror', (e) => result.errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        console.log('CONSOLE', name, message.text().slice(0, 350));
    });
    page.on('requestfailed', (request) =>
      console.log(
        'NETWORK',
        name,
        new URL(request.url()).origin === 'null'
          ? new URL(request.url()).protocol + new URL(request.url()).pathname
          : new URL(request.url()).origin + new URL(request.url()).pathname,
        request.failure()?.errorText
      )
    );
    page.on('response', async (response) => {
      const req = response.request(),
        url = new URL(req.url());
      if (response.status() >= 400)
        result.httpErrors.push({
          path: url.origin + url.pathname,
          method: req.method(),
          status: response.status(),
        });
      if (
        !url.pathname.startsWith('/email/email/') ||
        url.pathname.endsWith('health-check')
      )
        return;
      const record = {
        path: url.pathname + url.search,
        method: req.method(),
        status: response.status(),
      };
      record.linkId = req.headers()['x-email-link-id'];
      if (
        response.ok() &&
        (url.pathname.endsWith('/drafts') || url.pathname.endsWith('/messages'))
      ) {
        try {
          const json = await response.json();
          const value = json.draft || json.message;
          record.saved = value && {
            id: value.db_id,
            thread: value.thread_db_id,
          };
        } catch {}
      }
      result.responses.push(record);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) {
        try {
          record.body = req.postDataJSON();
        } catch {}
        writes.push(record);
      }
    });
    // Seeded accounts have no provider OAuth grant. Keep the seeded connection state
    // stable; all other requests reach the local services unless a scene labels a fault.
    await page.route('http://localstack:4566/**', (route) =>
      route.continue({
        url: route
          .request()
          .url()
          .replace('http://localstack:4566', 'http://localhost:24706'),
      })
    );
    await page.route('**/email/links/health-check', (route) =>
      route.fulfill({ status: 204 })
    );
    await page.route('**/email/links', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      for (const link of json.links || []) link.needs_reauth = false;
      await route.fulfill({ response, json });
    });
    const dismiss = async () => {
      const toast = page
        .locator('.island.bg-toast')
        .filter({ hasText: 'Reconnect Gmail' });
      if (await toast.count())
        await toast
          .locator('button')
          .filter({ has: page.locator('svg') })
          .first()
          .click();
    };
    const visit = async (key, query = '') => {
      await page.goto(`${origin}/app/email/${manifest.threads[key]}${query}`);
      await expect(page.locator('[data-message-body-id]').first()).toBeVisible({
        timeout: 60000,
      });
      await sleep(1200);
      await dismiss();
    };
    const check = async (label, assertion) => {
      await assertion();
      result.steps.push({ label, passed: true });
      console.log('PASS', name, label);
      await page.screencast.showOverlay(
        `<div style="position:absolute;bottom:10px;left:10px;max-width:92%;background:#173c28ee;color:white;padding:10px 16px;border-radius:8px;font:16px sans-serif">✓ ${label.replace(/[<>]/g, '')}</div>`,
        { duration: 1100 }
      );
    };
    try {
      await page.goto(`${origin}/app/component/mail`);
      if (options.mobile) await sleep(2500);
      else
        await expect(
          page.getByRole('button', { name: 'Go to Email', exact: true })
        ).toBeVisible({ timeout: 60000 });
      await dismiss();
      await page.screencast.start({
        path: `${output}/video/${name}.webm`,
        size: { width: 1440, height: 1000 },
      });
      await page.screencast.showChapter(name.replace(/-/g, ' '), {
        description: `${description}\n${result.evidence}`,
        duration: 2300,
      });
      await fn({
        page,
        context,
        manifest,
        visit,
        check,
        writes,
        result,
        expect,
        assert,
        sleep,
        origin,
        output,
        dismiss,
      });
      assert.deepEqual(result.errors, [], 'No uncaught browser exceptions');
      result.passed = true;
      await page.screenshot({ path: `${output}/artifacts/${name}.png` });
    } catch (error) {
      result.passed = false;
      result.failure = String(error).slice(0, 1500);
      result.body = (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(-6000);
      console.log('FAIL', name, String(error));
      await page
        .screenshot({ path: `${output}/artifacts/${name}-failure.png` })
        .catch(() => {});
    } finally {
      const scheduled = new Map();
      for (const r of result.responses) {
        if (
          r.path.endsWith('/email/messages') &&
          r.method === 'POST' &&
          r.saved
        )
          scheduled.set(r.saved.id, r.linkId);
        const match = r.path.match(/\/drafts\/scheduled\/([^?]+)/);
        if (match && r.status < 300) {
          if (r.method === 'PUT') scheduled.set(match[1], r.linkId);
          if (r.method === 'DELETE') scheduled.delete(match[1]);
        }
      }
      result.cleanup = [];
      for (const [id, linkId] of scheduled) {
        try {
          const clean = await page.evaluate(
            async ({ id, linkId }) => {
              const { emailClient } = await import(
                '/src/lib/service-clients/service-email/client.ts'
              );
              const r = await emailClient.unscheduleMessage(
                { draftID: id },
                linkId
              );
              return r.isOk()
                ? { cancelled: true }
                : { cancelled: false, error: r.error };
            },
            { id, linkId }
          );
          result.cleanup.push({ id, ...clean });
          if (!clean.cancelled) result.passed = false;
        } catch (error) {
          result.cleanup.push({ id, cancelled: false, error: String(error) });
          result.passed = false;
        }
      }
      result.finished = new Date().toISOString();
      await context.storageState({
        path: `${output}/${options.user || 'alex'}-auth.json`,
      });
      fs.chmodSync(`${output}/${options.user || 'alex'}-auth.json`, 0o600);
      const cookies = (await context.cookies())
        .map((c) => c.name + '=' + c.value)
        .join('; ');
      await page.screencast.stop().catch(() => {});
      await context.close();
      const drafts = new Map();
      for (const r of result.responses)
        if (r.saved?.id && !r.saved.id.startsWith('5eed'))
          drafts.set(r.saved.id, r.linkId);
      for (const [id, linkId] of drafts) {
        try {
          const response = await fetch(
            (process.env.EMAIL_REVIEW_API || 'http://localhost:24709') +
              '/email/email/drafts/' +
              id,
            {
              method: 'DELETE',
              headers: {
                cookie: cookies,
                ...(linkId ? { 'x-email-link-id': linkId } : {}),
              },
            }
          );
          result.cleanup.push({
            draft: id,
            removed: response.ok || response.status === 404,
            status: response.status,
          });
          if (!response.ok && response.status !== 404) result.passed = false;
        } catch (error) {
          result.cleanup.push({
            draft: id,
            removed: false,
            error: String(error),
          });
          result.passed = false;
        }
      }
      fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
    }
  };
  try {
    for (const chapter of chapters)
      await require('./chapters/' + chapter + '.cjs')(scene);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.passed);
  console.log(
    `RESULTS: ${results.length - failed.length}/${results.length} scenes passed; ${results.reduce((n, r) => n + r.steps.length, 0)} assertions`
  );
  if (failed.length) process.exitCode = 1;
}
module.exports = { run };
if (require.main === module)
  run(
    process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          'reading',
          'compose',
          'attachments',
          'resilience',
          'mobile',
          'advanced',
          'integration',
        ]
  ).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
