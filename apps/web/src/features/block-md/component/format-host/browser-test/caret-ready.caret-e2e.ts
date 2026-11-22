// C-TOUCH-CARET-MODE-01 part B (v12): the READY precondition, run once per
// engine build (CARET_ENGINE=source|native), with no caret rows. It loads EVERY
// (device, params) pair the rows load, DERIVED from caret-catalog.json (the
// rows read the same file), and asserts each one
// reaches html[data-ready]=='true' with zero page errors and zero console
// errors, recording every error with its exact URL, so a setup fault in any
// variant can never reach a counted run. DIAGNOSTIC-NO-CREDIT.
// v14: each case also records initialCoarse and the branch taken; the counted
// rows must reproduce the same pair for the same (device, params).
import { expect, test } from '@playwright/test';
import catalog from './caret-catalog.json' with { type: 'json' };
import { openCaretPage } from './caret-open';

const ENGINE = process.env.CARET_ENGINE;
if (ENGINE !== 'source' && ENGINE !== 'native')
  throw new Error('SETUP: set CARET_ENGINE to source or native');

/** Derived from caret-catalog.json, the rows' own source: the rows' devices,
 *  and each DISTINCT page params value the rows load (a variant). */
const DEVICES = catalog.devices;
const VARIANTS = [...new Set(catalog.rows.map((row) => row.params))].map(
  (params) => ({ name: params === '' ? 'plain' : params.slice(1), params })
);

for (const device of DEVICES)
  test.describe(`${ENGINE} ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.isMobile,
      hasTouch: true,
    });

    for (const variant of VARIANTS)
      test(`${device.name} ${variant.name} caret page loads ready with no page or console errors`, async ({
        page,
      }, info) => {
        const pageErrors: string[] = [];
        const consoleErrors: { text: string; url: string }[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error')
            consoleErrors.push({
              text: message.text(),
              url: message.location().url,
            });
        });
        // v13 (t232): the rows' exact setup (caret-open.ts), so each case proves the device
        // facts for its (device, variant) as well as a clean mount.
        const setup: Record<string, unknown> = {};
        let ready: string | null = null;
        // C-TOUCH-CARET-WEBKIT-01 packet B: the Tauri-iOS boundary's at-load IPC
        // log on an ?ios variant (index.html), null otherwise.
        let ipcLog: unknown[] | null = null;
        try {
          await openCaretPage(page, device, variant.params, ENGINE, setup);
          ready = await page.locator('html').getAttribute('data-ready');
          ipcLog = await page.evaluate(
            () =>
              (
                window as unknown as { __TAURI_CARET_IPC_LOG__?: unknown[] }
              ).__TAURI_CARET_IPC_LOG__?.slice() ?? null
          );
        } finally {
          await info.attach('caret-ready-facts', {
            body: JSON.stringify({
              engine: ENGINE,
              device: device.name,
              variant: variant.name,
              ready,
              deviceFacts: setup.device ?? null,
              initialCoarse: setup.initialCoarse ?? null,
              touchMechanism: setup.touchMechanism ?? null,
              ipcLog,
              pageErrors,
              consoleErrors,
            }),
            contentType: 'application/json',
          });
        }
        expect({ ready, pageErrors, consoleErrors }).toEqual({
          ready: 'true',
          pageErrors: [],
          consoleErrors: [],
        });
      });
  });
