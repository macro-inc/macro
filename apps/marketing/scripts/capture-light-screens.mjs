import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Light counterparts of the site's app captures, taken from the website's own
// sample workspace in the cream palette: local fixtures only, never customer
// data, and never inverted or recolored dark frames.
//
// Run with the marketing dev server running:
//   bun scripts/capture-light-screens.mjs [origin] [name ...]
// Names limit the run to those captures, e.g. `home mail-thread`.
const origin = process.argv[2] ?? 'https://localhost:5191';
const only = new Set(process.argv.slice(3));
const components = '/src/features/marketing/components/';

const calls = ['calls/CallStories.tsx', 'CallDefaultDemo'];
const pullRequest = ['reviews/GithubWorkflow.tsx', 'GithubPrHero'];

// The poster each product page shows before its tutorial video plays.
const tutorialPreviews = {
  home: { props: { initialView: 'home' } },
  mail: { props: { initialView: 'email' } },
  tasks: { props: { initialView: 'tasks', tasksShowcase: true } },
  chat: { props: { initialView: 'messages' } },
  docs: { props: { initialView: 'documents', initialDocument: 'plan' } },
  drive: { props: { initialView: 'documents' } },
  calendar: { props: { initialView: 'calendar' } },
  crm: { props: { initialView: 'crm' } },
  agents: { props: { initialView: 'messages', agentShowcase: true } },
  calls: {
    props: { initialView: 'messages', demoTitle: 'Launch team' },
    component: calls,
  },
  github: {
    props: { initialView: 'tasks', demoTitle: 'Pull request' },
    component: pullRequest,
  },
  scheduling: { props: { initialView: 'calendar' } },
};

// The homepage tour and product sections. Each name matches the dark capture
// in src/assets/homepage/ that it stands in for; `click` opens the same kind
// of view that capture shows.
const homepageScreens = {
  home: {
    props: { initialView: 'home' },
    click: [{ text: 'What’s left before launch?' }],
  },
  inbox: {
    props: { initialView: 'home' },
    click: [{ text: 'Homepage feedback' }],
  },
  mail: { props: { initialView: 'email' } },
  'mail-thread': {
    props: { initialView: 'email' },
    click: [{ text: 'Team rollout plan' }],
  },
  chat: { props: { initialView: 'messages' } },
  'chat-thread': {
    props: { initialView: 'messages' },
    click: [{ role: 'button', name: /repl(y|ies)/i }],
  },
  tasks: { props: { initialView: 'tasks' } },
  'tasks-board': {
    props: { initialView: 'tasks', tasksShowcase: true },
    click: [
      { role: 'button', name: 'Task layout' },
      { role: 'menuitemradio', name: 'Board' },
    ],
  },
  calendar: { props: { initialView: 'calendar' } },
  docs: { props: { initialView: 'documents', initialDocument: 'plan' } },
  'docs-split': {
    props: { initialView: 'documents', initialDocument: 'rollout' },
  },
  crm: { props: { initialView: 'crm', initialCompany: 'meadow' } },
  'crm-board': { props: { initialView: 'crm' } },
  call: {
    props: { initialView: 'messages', demoTitle: 'Launch team' },
    component: calls,
    click: [{ text: 'Weekly planning' }],
  },
  calls: {
    props: { initialView: 'messages', demoTitle: 'Launch team' },
    component: calls,
  },
  agents: { props: { initialView: 'messages', agentShowcase: true } },
  'pull-request': {
    props: { initialView: 'tasks', demoTitle: 'Pull request' },
    component: pullRequest,
  },
};

const captureStyles = `
  /* Only the capture paints, so a homepage window's corners stay transparent. */
  html, body, #root, .dummy-route { background:transparent !important }
  .tutorial-capture .dummy-workspace[data-embedded=true] { height:100%;border:0;border-radius:0;box-shadow:none }
  .tutorial-capture .dummy-banner { display:none }
  .tutorial-capture .call-flow,.tutorial-capture .call-flow-frame,.tutorial-capture .product-demo-stage,.tutorial-capture .product-demo { height:100%;max-height:none;flex:1;margin:0;transform:none;border-radius:0;mask-image:none }
  .tutorial-capture .feature-demo-primary { width:100%;transform:none }
  /* A homepage window keeps the rounded corners of the app windows it replaces. */
  .tutorial-capture[data-window] { overflow:hidden;border-radius:12px;box-shadow:inset 0 0 0 1px #1d1c1a1f }
  .tutorial-capture[data-window]::after { content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inherit;pointer-events:none }
`;

/** Mounts the sample workspace over the page, in the state a capture asks for. */
async function mountWorkspace(page, config, window) {
  await page.goto(`${origin}/demo?theme=cream`);
  await page.locator('.dummy-workspace').waitFor();
  await page.evaluate(
    async ({ config, components, window }) => {
      // Use Vite's exact Solid instance, including its dependency cache version.
      const source = await (
        await fetch('/src/app/routes/RouteDemo.tsx')
      ).text();
      const web = source.match(/from "([^"]*solid-js_web[^"]*)"/)?.[1];
      if (!web) throw new Error('Could not find the preview Solid runtime');
      const { render, createComponent } = await import(web);
      const { default: Workspace } = await import(
        `${components}workspace/DummyWorkspace.tsx`
      );
      const { DemoInteractionScope } = await import(
        `${components}DemoInteractionBoundary.tsx`
      );
      const child = config.component
        ? (await import(components + config.component[0]))[config.component[1]]
        : undefined;

      // Replace the route's own workspace so only the capture is on screen,
      // inside the element that carries the cream workspace tokens.
      const route = document.querySelector('.dummy-route');
      for (const node of [...route.children]) {
        if (node.tagName !== 'STYLE') node.remove();
      }

      const root = document.createElement('div');
      root.className = 'tutorial-capture';
      root.toggleAttribute('data-window', window);
      root.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:var(--color-surface-0)';
      route.append(root);
      render(
        () =>
          createComponent(DemoInteractionScope, {
            get children() {
              return createComponent(Workspace, {
                ...config.props,
                embedded: true,
                get demoContent() {
                  return child ? createComponent(child, {}) : undefined;
                },
              });
            },
          }),
        root
      );
    },
    { config, components, window }
  );
  await page.addStyleTag({ content: captureStyles });

  for (const target of config.click ?? []) {
    const scope = page.locator('.tutorial-capture');
    const locator = target.role
      ? scope.getByRole(target.role, { name: target.name })
      : scope.getByText(target.text, { exact: true });
    await locator.first().click();
  }
  // Move the pointer away so no hover state is captured.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** Chromium encodes WebP itself, so the script needs no image library. */
async function toWebp(page, png) {
  const dataUrl = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.9);
  }, `data:image/png;base64,${png.toString('base64')}`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const wanted = (name) => only.size === 0 || only.has(name);
const browser = await chromium.launch({ headless: true });
try {
  const previewPage = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 692 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  for (const [id, config] of Object.entries(tutorialPreviews)) {
    if (!wanted(id)) continue;
    await mountWorkspace(previewPage, config, false);
    await previewPage.locator('.tutorial-capture').screenshot({
      path: fileURLToPath(
        new URL(
          `../public/video/tutorials/${id}-preview-light.jpg`,
          import.meta.url
        )
      ),
      type: 'jpeg',
      quality: 90,
    });
    console.log(`Captured tutorial preview ${id}`);
  }

  // 1360×733 at 1.25x is the 1700×916 frame of the dark homepage captures.
  const screenPage = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 733 },
    deviceScaleFactor: 1.25,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  for (const [name, config] of Object.entries(homepageScreens)) {
    if (!wanted(name)) continue;
    await mountWorkspace(screenPage, config, true);
    const png = await screenPage
      .locator('.tutorial-capture')
      .screenshot({ omitBackground: true });
    await writeFile(
      fileURLToPath(
        new URL(`../src/assets/homepage/${name}-light.webp`, import.meta.url)
      ),
      await toWebp(screenPage, png)
    );
    console.log(`Captured homepage screen ${name}`);
  }
} finally {
  await browser.close();
}
