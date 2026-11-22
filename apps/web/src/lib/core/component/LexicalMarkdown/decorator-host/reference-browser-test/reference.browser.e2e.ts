import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/reference-browser-test/fixture.html';
const sourceOnly = process.env.REFERENCE_SOURCE_ONLY === '1';
const entity = {
  id: 'reference-pr',
  foreignEntityId: 'owner/repo/pull/7',
  foreignEntitySource: 'github_pull_request',
  metadata: {
    name: 'Resolved PR',
    owner: 'owner',
    repo: 'repo',
    number: 7,
    url: 'https://github.com/owner/repo/pull/7',
    status: 'merged',
    additions: 9,
    deletions: 2,
  },
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  storedForAuthEntity: 'user',
  storedForId: 'fixture-user',
};

async function services(page: Page) {
  let released = false;
  const pending = new Set<() => Promise<void>>();
  await page.route('**/__macro_dev/gateway/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/email/links'))
      return route.fulfill({ json: { links: [] } });
    if (url.pathname.endsWith('/link/github/status'))
      return route.fulfill({ json: { reauthentication_required: false } });
    if (url.pathname.endsWith('/foreign_entity/reference-pr')) {
      if (released) return route.fulfill({ json: entity });
      return new Promise<void>((resolve) => {
        const send = async () => {
          try {
            await route.fulfill({ json: entity });
          } finally {
            pending.delete(send);
            resolve();
          }
        };
        pending.add(send);
      });
    }
    return route.fulfill({
      status: 403,
      json: { message: 'Fixture access denied' },
    });
  });
  return async () => {
    released = true;
    await Promise.all([...pending].map((send) => send()));
  };
}

async function capture(page: Page) {
  return page.evaluate(() => {
    if (!window.referenceProofFixture)
      throw new Error('Missing actual reference surface');
    return window.referenceProofFixture.snapshot();
  });
}

test.beforeAll(async ({ browser }) => {
  for (const kind of ['pr-mention', 'snapshot']) {
    const page = await browser.newPage();
    const release = await services(page);
    try {
      await page.goto(`${path}?engine=factory&kind=${kind}`);
      await expect(
        page.getByRole('textbox', { name: 'Reference proof' })
      ).toContainText(kind === 'snapshot' ? 'Snapshot fixture' : 'Original PR');
    } finally {
      try {
        await page.evaluate(() => window.referenceProofClose?.());
      } finally {
        try {
          await release();
        } finally {
          await page.close();
        }
      }
    }
  }
});

const variants =
  process.env.REFERENCE_NULLABLE_ONLY === '1'
    ? [true]
    : process.env.REFERENCE_STANDARD_ONLY === '1'
      ? [false]
      : [false, true];

for (const kind of ['pr-mention', 'snapshot']) {
  for (const nullable of variants) {
    test(`${kind} ${nullable ? 'nullable' : 'standard'} raw model, selection, Normal Enter and content actions`, async ({
      context,
    }, info) => {
      const factory = await context.newPage();
      const source = await context.newPage();
      const native = sourceOnly ? undefined : await context.newPage();
      const pages = native ? [factory, source, native] : [factory, source];
      const proofs = pages.map(watchCompiledSourceDeps);
      const servicesByPage = await Promise.all(pages.map(services));
      const records = [];
      const errors: string[] = [];
      const unavailable: string[] = [];
      for (const page of pages) {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.text() === 'No split manager found')
            unavailable.push(page === source ? 'lexical' : 'native');
        });
      }
      let dependencyProofs: PromiseSettledResult<unknown>[] = [];
      let cleanup: PromiseSettledResult<void>[] = [];
      try {
        await factory.bringToFront();
        await factory.goto(`${path}?engine=factory&kind=${kind}`);
        const rootFactory = factory.getByRole('textbox', {
          name: 'Reference proof',
        });
        await expect(rootFactory).toContainText(
          kind === 'snapshot' ? 'Snapshot fixture' : 'Original PR'
        );
        let input = (await capture(factory)).model;
        if (nullable) {
          const uuid =
            kind === 'snapshot'
              ? '"mentionUuid":"reference-snapshot"'
              : '"mentionUuid":"reference-instance"';
          expect(input.split(uuid)).toHaveLength(2);
          input = input.replace(uuid, '"mentionUuid":null');
          if (kind === 'pr-mention') {
            expect(input.split('"label":"Original PR"')).toHaveLength(2);
            input = input.replace('"label":"Original PR"', '"label":null');
          }
        }
        for (const [engine, page] of [
          ['lexical', source],
          ['native', native],
        ] as const) {
          if (!page) continue;
          await page.addInitScript((model) => {
            window.referenceProofInput = model;
          }, input);
          await page.bringToFront();
          await page.goto(`${path}?engine=${engine}&kind=${kind}`);
          const root = page.getByRole('textbox', { name: 'Reference proof' });
          await expect(root).toContainText(
            kind === 'snapshot'
              ? 'Snapshot fixture'
              : nullable
                ? 'Pull request'
                : 'Original PR'
          );
          await expect
            .poll(() => page.evaluate(() => !!window.referenceProofFixture))
            .toBe(true);
          const stages = [await capture(page)];
          records.push({ engine, stages });
          await page.evaluate(() => window.referenceProofFixture?.select());
          await expect(root.locator('.bg-active.text-ink')).toHaveCount(1);
          stages.push(await capture(page));
          expect(
            await page.evaluate(() => window.referenceProofFixture?.enter())
          ).toBe(true);
          await expect
            .poll(() => unavailable.filter((arm) => arm === engine).length)
            .toBe(1);
          stages.push(await capture(page));
          if (kind === 'pr-mention') {
            await servicesByPage[pages.indexOf(page)]?.();
            await expect(root).toContainText('Resolved PR');
            await expect
              .poll(async () => (await capture(page)).model)
              .toContain('owner/repo#7 Resolved PR');
            await expect
              .poll(async () => (await capture(page)).model)
              .toContain('https://github.com/owner/repo/pull/7');
            stages.push(await capture(page));
            await root.locator('[data-pr-id="reference-pr"]').hover();
            await expect(
              page.getByText('Resolved PR', { exact: true })
            ).toHaveCount(2);
            stages.push(await capture(page));
          } else {
            await root.locator('[data-snapshot-node]').hover();
            const actions = page.getByRole('button', {
              name: 'Reference actions',
            });
            await expect(actions).toBeVisible();
            stages.push(await capture(page));
            await actions.click();
            await page
              .getByRole('menuitem', { name: 'Delete', exact: true })
              .click();
            await expect(root.locator('[data-snapshot-node]')).toHaveCount(0);
            stages.push(await capture(page));
          }
        }
        if (native) expect(records[1]?.stages).toEqual(records[0]?.stages);
        expect(errors).toEqual([]);
      } finally {
        try {
          dependencyProofs = await Promise.allSettled(
            proofs.map((finish) => finish())
          );
          await info.attach('reference-raw.json', {
            contentType: 'application/json',
            body: JSON.stringify({
              kind,
              nullable,
              records,
              errors,
              unavailable,
              compiledProofs: dependencyProofs.map((result) =>
                result.status === 'fulfilled'
                  ? result.value
                  : { error: String(result.reason) }
              ),
            }),
          });
        } finally {
          cleanup = await Promise.allSettled(
            pages.map(async (page, index) => {
              try {
                await page.evaluate(() => window.referenceProofClose?.());
                await servicesByPage[index]?.();
              } finally {
                await page.close();
              }
            })
          );
        }
      }
      expect(dependencyProofs.map((result) => result.status)).toEqual(
        pages.map(() => 'fulfilled')
      );
      expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(
        true
      );
    });
  }
}
