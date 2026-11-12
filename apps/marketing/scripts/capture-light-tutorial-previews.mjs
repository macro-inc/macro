import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Capture the existing local UI fixtures, never customer data or inverted video frames.
// Run with the marketing Vite server running: bun scripts/capture-light-tutorial-previews.mjs [origin]
const origin = process.argv[2] ?? 'https://localhost:5191';
const components = '/src/features/marketing/components/';
const previews = {
  home: { initialView: 'home' },
  mail: { initialView: 'email' },
  tasks: { initialView: 'tasks', tasksShowcase: true },
  chat: { initialView: 'messages' },
  docs: { initialView: 'documents', initialDocument: 'plan' },
  drive: { initialView: 'documents' },
  calendar: { initialView: 'calendar' },
  crm: { initialView: 'crm' },
  agents: { initialView: 'messages', agentShowcase: true },
  calls: { initialView: 'messages', demoTitle: 'Launch team', component: ['calls/CallStories.tsx', 'CallDefaultDemo'] },
  github: { initialView: 'tasks', demoTitle: 'Pull request', component: ['reviews/GithubWorkflow.tsx', 'GithubPrHero'] },
  scheduling: { initialView: 'calendar', demoTitle: 'Booking links', component: ['BookingLinkStories.tsx', 'BookingLinkStories'] },
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 692 }, colorScheme: 'light', reducedMotion: 'reduce' });
  for (const [id, config] of Object.entries(previews)) {
    await page.goto(`${origin}/demo?theme=cream`);
    await page.locator('.dummy-workspace').waitFor();
    await page.evaluate(async ({ config, components }) => {
      // Use Vite's exact Solid instance, including its dependency cache version.
      const source = await (await fetch('/src/app/routes/RouteDemo.tsx')).text();
      const web = source.match(/from "([^"]*solid-js_web[^\"]*)"/)?.[1];
      if (!web) throw new Error('Could not find the preview Solid runtime');
      const { render, createComponent } = await import(web);
      const { default: Workspace } = await import(`${components}workspace/DummyWorkspace.tsx`);
      const { DemoInteractionScope } = await import(`${components}DemoInteractionBoundary.tsx`);
      const child = config.component ? (await import(components + config.component[0]))[config.component[1]] : undefined;
      const root = document.createElement('div');
      root.className = 'dummy-route tutorial-capture';
      root.style.cssText = 'position:fixed;inset:0;z-index:99999';
      document.body.append(root);
      render(() => createComponent(DemoInteractionScope, {
        get children() {
          return createComponent(Workspace, {
            ...config, embedded: true,
            get demoContent() { return child ? createComponent(child, {}) : undefined; },
          });
        },
      }), root);
    }, { config, components });
    await page.addStyleTag({ content: `
      .tutorial-capture .dummy-workspace[data-embedded=true] { height:692px;border:0;border-radius:0;box-shadow:none }
      .tutorial-capture .dummy-banner { display:none }
      .tutorial-capture .call-flow,.tutorial-capture .call-flow-frame,.tutorial-capture .product-demo-stage,.tutorial-capture .product-demo { height:100%;max-height:none;flex:1;margin:0;transform:none;border-radius:0;mask-image:none }
      .tutorial-capture .booking-link-stories { padding:24px }
      .tutorial-capture .booking-link-stories .feature-page-section:not(:first-child),.tutorial-capture .booking-link-stories header,.tutorial-capture .feature-demo-backdrop,.tutorial-capture .feature-demo-context { display:none }
      .tutorial-capture .booking-link-stories .feature-page-section,.tutorial-capture .feature-demo-art { margin:0;padding:0 }
      .tutorial-capture .feature-demo-primary { width:100%;transform:none }
    ` });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.tutorial-capture').screenshot({ path: fileURLToPath(new URL(`../public/video/tutorials/${id}-preview-light.jpg`, import.meta.url)), type: 'jpeg', quality: 90 });
    console.log(`Captured ${id}`);
  }
} finally {
  await browser.close();
}
