import { createScene, translation } from '@macro-inc/graphics';
import type { ArtifactLibrary } from '@macro-inc/graphics/loro';
import { expect, type Frame, type Page, test } from '@playwright/test';

// A fresh page loads the render bundle unbundled from the dev server.
test.setTimeout(180_000);

const artifactScene = (html: string) =>
  createScene([
    {
      id: 'artifact',
      type: 'artifact',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      appearance: { fill: '#fff', stroke: '#000' },
      geometry: {
        width: 640,
        height: 360,
        title: 'Sandbox test',
        html,
        designWidth: 1280,
        designHeight: 720,
        presentOrder: 'a0',
      },
    },
  ]);

async function renderArtifact(
  page: Page,
  html: string,
  artifactLibrary?: ArtifactLibrary
): Promise<Frame> {
  await page.goto('/canvas-render.html');
  await page.waitForFunction(() => window.canvasRenderIdle === true, null, {
    timeout: 150_000,
  });
  await page.evaluate(
    ({ document, artifactLibrary }) =>
      window.renderCanvasSnapshot({
        document,
        artifactLibrary,
        crop: { x: 0, y: 0, width: 640, height: 360 },
        scale: 1,
        revision: 'test',
        artifacts: true,
      }),
    { document: artifactScene(html), artifactLibrary }
  );

  const element = await page.waitForSelector(
    'iframe[data-canvas-artifact-frame]'
  );
  const frame = await element.contentFrame();
  if (!frame) throw new Error('Artifact frame has no document.');
  return frame;
}

test('runs scripts with no access to the app', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'session',
      value: 'app-secret',
      url: new URL('/', test.info().project.use.baseURL).href,
    },
  ]);
  const frame = await renderArtifact(
    page,
    '<p id="out">waiting</p><script>document.getElementById("out").textContent = "ran";</script>'
  );

  await expect(frame.locator('#out')).toHaveText('ran');
  const access = await frame.evaluate(() => {
    const attempt = (read: () => unknown) => {
      try {
        return { value: read() };
      } catch (error) {
        return { blocked: (error as Error).name };
      }
    };
    return {
      origin: window.origin,
      cookie: attempt(() => document.cookie),
      storage: attempt(() => localStorage.length),
      parent: attempt(() => window.parent.document.title),
    };
  });

  expect(access.origin).toBe('null');
  expect(access.cookie).toHaveProperty('blocked');
  expect(access.storage).toHaveProperty('blocked');
  expect(access.parent).toHaveProperty('blocked');
});

test('blocks network requests', async ({ page }) => {
  // Only a request that reaches the network layer is routed.
  const sent: string[] = [];
  await page.route('https://example.com/**', (route) => {
    sent.push(route.request().url());
    return route.fulfill({ status: 200, body: '' });
  });
  const frame = await renderArtifact(page, '<p>Hi</p>');

  const result = await frame.evaluate(() =>
    Promise.allSettled([
      fetch('https://example.com/fetch'),
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = 'https://example.com/image.png';
      }),
    ]).then((results) => results.map(({ status }) => status))
  );

  expect(result).toEqual(['rejected', 'rejected']);
  expect(sent).toEqual([]);
});

test('removes a frame that navigates away', async ({ page }) => {
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Remote page</p>' })
  );
  const frame = await renderArtifact(page, '<p>Hi</p>');

  await frame
    .evaluate(() => {
      window.location.href = 'https://example.com/leave';
    })
    .catch(() => {});

  await expect(page.locator('iframe[data-canvas-artifact-frame]')).toHaveCount(
    0
  );
  await expect(page.getByText('tried to leave its page')).toBeVisible();
});

test('expands shared styles and components', async ({ page }) => {
  const frame = await renderArtifact(
    page,
    '<macro-style name="brand"></macro-style><macro-component name="card">Hello</macro-component>',
    {
      styles: { brand: '#card { color: rgb(255, 0, 0); }' },
      components: { card: '<p id="card"><slot></slot></p>' },
    }
  );

  const card = frame.locator('#card');
  await expect(card).toHaveText('Hello');
  await expect(card).toHaveCSS('color', 'rgb(255, 0, 0)');
});
