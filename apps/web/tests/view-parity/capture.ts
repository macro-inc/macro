import { expect, type Page } from '@playwright/test';

/** One control a person can see and act on, with where it sits. */
export type ControlBox = {
  kind: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewCapture = {
  /** Roles, accessible names and text, without layout-only wrappers. */
  aria: string;
  /** Every visible control and header island, in document order. */
  controls: ControlBox[];
  /** Whether touch detection and the `touch:` styles agree with the profile. */
  touch: { pointerCoarse: boolean; attribute: string | undefined };
  errors: string[];
};

const CONTROL_SELECTOR =
  'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="radio"], [contenteditable="true"], [data-header-island]';

function readControls(page: Page): Promise<ControlBox[]> {
  return page.evaluate((selector) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };

    return [...document.querySelectorAll(selector)]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label =
          element.getAttribute('aria-label') ??
          element.textContent?.replace(/\s+/g, ' ').trim() ??
          '';
        return {
          kind: element.hasAttribute('data-header-island')
            ? 'island'
            : (element.getAttribute('role') ?? element.tagName.toLowerCase()),
          name: label.slice(0, 80),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
  }, CONTROL_SELECTOR);
}

/** The controls once two readings agree, so a capture never lands mid-transition. */
async function settledControls(page: Page): Promise<ControlBox[]> {
  let controls = await readControls(page);

  await expect(async () => {
    const before = controls;
    await page.waitForTimeout(250);
    controls = await readControls(page);
    expect(controls).toEqual(before);
  }).toPass({ timeout: 15_000 });

  return controls;
}

/**
 * What the two builds must agree on: the accessibility tree and the geometry
 * of every control. Class names and wrapper elements are left out, because a
 * refactor may change them without changing what anyone sees.
 */
export async function captureView(
  page: Page,
  errors: string[]
): Promise<ViewCapture> {
  const controls = await settledControls(page);
  const aria = await page.locator('body').ariaSnapshot();

  const touch = await page.evaluate(() => ({
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    attribute: document.documentElement.dataset.touchDevice,
  }));

  return { aria, controls, touch, errors: [...errors] };
}
