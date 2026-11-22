// C-TOUCH-CARET-MODE-01 part B (v13): the ONE caret page setup both specs run
// (caret-mode.caret-e2e.ts rows and caret-ready.caret-e2e.ts), so the ready
// precondition loads every page exactly as the rows do: about:blank, touch
// emulation when coarse pointer is not already on (isTouchDevice.ts samples it
// at module load), navigation, the data-ready wait, the engine check, and the
// device-facts equality against the catalog device.
// v14 (t1yg's ruling): the touch branch is not a per-device constant. The pinned
// browser and context decide it, so it is recorded (initialCoarse) and must be
// consistent with the mechanism taken, with coarse true after setup.
import { expect, type Page } from '@playwright/test';
import type catalog from './caret-catalog.json';

export type CaretDevice = (typeof catalog.devices)[number];

/** The two setup branches, by name: the context's hasTouch alone already gives a
 *  coarse pointer, or CDP touch emulation was added on top of it. */
export const NATIVE_BRANCH = 'hasTouch';
export const CDP_BRANCH = 'hasTouch+Emulation.setTouchEmulationEnabled';

/** Opens the caret page as the rows do; records initialCoarse, the touch
 *  mechanism, the raw device facts and isContentEditable into `record`. Throws
 *  SETUP on an inconsistent branch, coarse not true after setup, or a
 *  device-facts mismatch. */
export async function openCaretPage(
  page: Page,
  device: CaretDevice,
  params: string,
  engine: string,
  record: Record<string, unknown>
) {
  await page.goto('about:blank');
  const initialCoarse = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches
  );
  record.initialCoarse = initialCoarse;
  let mechanism = NATIVE_BRANCH;
  if (!initialCoarse) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    mechanism = CDP_BRANCH;
  }
  await page.goto(`/?caret${params}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator('#caret-facts').textContent()) || '{}')
          .engine
    )
    .toBe(engine);
  const observed = JSON.parse(
    (await page.locator('#caret-device').textContent()) || '{}'
  );
  record.touchMechanism = mechanism;
  record.device = observed;
  if (mechanism !== (initialCoarse ? NATIVE_BRANCH : CDP_BRANCH))
    throw new Error(
      `SETUP: ${device.name} branch ${mechanism} with initialCoarse ${initialCoarse}`
    );
  if (observed.coarse !== true)
    throw new Error(
      `SETUP: ${device.name} coarse ${observed.coarse} after setup`
    );
  if (JSON.stringify(observed) !== JSON.stringify(device.expected))
    throw new Error(
      `SETUP: ${device.name} device facts ${JSON.stringify(observed)}`
    );
  record.editable = await page.evaluate(
    () => document.getElementById('body')?.isContentEditable ?? null
  );
}
