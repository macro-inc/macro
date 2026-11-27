import type { JSHandle } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { fileIntoDrive } from './harness/ways-faults';

const team = '00000000-0000-4000-8000-000000000001';
const file = {
  filename: 'notes.txt',
  mimeType: 'text/plain',
  fileType: 'txt',
  text: 'Fresh file content.',
};

for (const mobile of [false, true]) {
  test.describe(`file loading across a session transition on ${mobile ? 'phone' : 'desktop'}`, () => {
    test.use({
      provider: 'GMAIL',
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });

    // Desktop uses Drive's FileDetailLoadGate; a touch code URL keeps the
    // legacy BlockLoader. Neither may publish a body from the retired session.
    test('restarts a delayed file load once with fresh metadata', async ({
      page,
      mailbox,
    }) => {
      await loadAppSteadily(page);
      let allowed = true;
      await page.route('**/dss/crm/member-access', (route) =>
        route.fulfill({ json: { allowed, team_id: team } })
      );
      await mailbox.deliver({
        from: 'reader@example.com',
        subject: 'Attached notes',
        text: 'The notes are attached.',
        attachments: [
          {
            filename: file.filename,
            mimeType: file.mimeType,
            base64: Buffer.from(file.text).toString('base64'),
          },
        ],
      });
      const thread = await mailbox.synced('Attached notes');
      const copy = await fileIntoDrive(mailbox, thread.id, file);
      const firstBody = Promise.withResolvers<void>();
      const releaseBody = Promise.withResolvers<void>();
      let bodies = 0;
      let metadata = 0;
      await page.route(`**/dss/documents/${copy}`, (route) => {
        if (route.request().method() === 'GET') metadata++;
        return route.fallback();
      });
      await page.route(
        `**/dss/documents/${copy}/location_v3?*`,
        async (route) => {
          // The harness files metadata but not the attachment's Drive bytes.
          // Preserve the real location response and supply those bytes below.
          const response = await route.fetch();
          const location = await response.json();
          await route.fulfill({
            response,
            json: {
              ...location,
              presignedUrl: new URL(`/file-body/${copy}`, page.url()).href,
            },
          });
        }
      );
      await page.route(`**/file-body/${copy}`, async (route) => {
        bodies++;
        const first = bodies === 1;
        if (first) {
          firstBody.resolve();
          await releaseBody.promise;
        }
        await route.fulfill({
          contentType: file.mimeType,
          body: first ? 'Discarded file content.' : file.text,
        });
      });

      let textWatch:
        | JSHandle<{ retired: boolean; stop: () => void }>
        | undefined;
      try {
        await mailbox.open(`/app/code/${copy}`);
        await firstBody.promise;
        textWatch = await page.evaluateHandle(() => {
          const result = { retired: false, stop: () => observer.disconnect() };
          const inspect = (text: string | null) => {
            if (text?.includes('Discarded file content.'))
              result.retired = true;
          };
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              inspect(record.oldValue);
              inspect(record.target.textContent);
              for (const node of [...record.addedNodes, ...record.removedNodes])
                inspect(node.textContent);
            }
          });
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            characterDataOldValue: true,
          });
          return result;
        });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const raw = localStorage.getItem(
                'graphql-cache:authority-hint:v1'
              );
              return raw ? JSON.parse(raw).policy : null;
            })
          )
          .toBe(`${team}:allowed`);
        const before = metadata;
        allowed = false;
        await page.evaluate(() => {
          window.dispatchEvent(new Event('offline'));
          window.dispatchEvent(new Event('online'));
        });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const raw = localStorage.getItem(
                'graphql-cache:authority-hint:v1'
              );
              const authority = raw ? JSON.parse(raw) : null;
              return authority?.ready ? authority.policy : null;
            })
          )
          .toBe(`${team}:denied`);
        releaseBody.resolve();
        await expect(page.locator('.cm-content')).toHaveText(file.text);
        expect(await textWatch.evaluate((watch) => watch.retired)).toBe(false);
        await expect(
          page.getByText('Discarded file content.', { exact: true })
        ).toHaveCount(0);
        expect(bodies).toBe(2);
        expect(metadata).toBeGreaterThan(before);
      } finally {
        releaseBody.resolve();
        await textWatch?.evaluate((watch) => watch.stop()).catch(() => {});
        await textWatch?.dispose();
      }
    });
  });
}
