import type { Page } from '@playwright/test';

/** Block every request off this machine; the fixture's feed is in memory. */
export async function stayLocal(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (loopback && request.method() === 'GET') {
      const responses: Record<string, object> = {
        '/__macro_dev/gateway/dss/comms/channels': {
          items: [],
          next_cursor: null,
        },
        '/__macro_dev/gateway/dss/channels/activity': [],
        '/__macro_dev/gateway/email/email/links': { links: [] },
      };
      const response = responses[url.pathname];
      if (response) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
      }
    }
    if (
      (!loopback && !['data:', 'blob:'].includes(url.protocol)) ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}
