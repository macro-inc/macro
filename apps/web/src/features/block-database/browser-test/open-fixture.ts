import type { Page } from '@playwright/test';

/** Retry canceled startup module requests when the devbox's container network changes. */
export async function openFixture(page: Page, url: string) {
  let networkChanged = false;
  const failed = (request: import('@playwright/test').Request) => {
    if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED')
      networkChanged = true;
  };
  page.on('requestfailed', failed);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      networkChanged = false;
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      if (!networkChanged) return;
    }
    throw new Error('The devbox network kept canceling fixture startup.');
  } finally {
    page.off('requestfailed', failed);
  }
}
