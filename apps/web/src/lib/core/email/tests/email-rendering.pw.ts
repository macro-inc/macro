import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { DEFAULT_THEMES } from '@theme/constants';
import { EMAIL_BODY_CONTAINMENT_CSS } from '../../../../features/block-email/util/emailBodyContainmentCss';
import { fitToWidthZoom } from '../../../../features/block-email/util/fitToWidthZoom';

/**
 * Email fixture format - matches the structure from email service.
 *
 * ## Adding a new fixture:
 * 1. Create a JSON file in the fixtures/ directory (e.g., `my-email.json`)
 * 2. Copy `body_html_sanitized` from an email API response into the file
 * 3. From the repo root, run `just test-email-rendering-update`
 * 4. Commit the fixture and snapshots
 *
 * Optional `container_widths` (default `[600]`) snapshots extra pane sizes.
 * Use that only when a fixture needs a width the default pane cannot prove.
 *
 * ## Example fixture file:
 * ```json
 * {
 *   "name": "outlook-signature",
 *   "description": "Email with Outlook signature formatting",
 *   "body_html_sanitized": "<p>Hello...</p><div class='signature'>...</div>"
 * }
 * ```
 */
interface EmailFixture {
  /** Unique name for the fixture (used in snapshot filenames) */
  name: string;
  /** Description of what this fixture tests */
  description: string;
  /** The sanitized HTML body - copy directly from email service `body_html_sanitized` field */
  body_html_sanitized: string;
  /** Pane widths in CSS pixels. Omit to use the default 600px reader pane. */
  container_widths?: number[];
}

/** Themes to test - uses actual Macro theme definitions */
const THEMES = ['Macro Dark', 'Macro Light'] as const;

const DEFAULT_CONTAINER_WIDTH = 600;

function containerWidths(fixture: EmailFixture): number[] {
  return fixture.container_widths ?? [DEFAULT_CONTAINER_WIDTH];
}

function generateThemeCSS(themeName: string): string {
  const theme = DEFAULT_THEMES.find((t) => t.name === themeName);
  if (!theme) return '';

  const vars = Object.entries(theme.colorTokens)
    .map(([key, value]) => `--color-${key}: ${value};`)
    .join('\n    ');

  return `:root {\n    ${vars}\n  }`;
}

function createTestHTML(args: {
  themeName: string;
  containerWidth: number;
}): string {
  const themeCSS = generateThemeCSS(args.themeName);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      ${themeCSS}

      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        background-color: var(--color-surface-1);
        color: var(--color-content-0);
        padding: 16px;
      }

      .email-host {
        width: ${args.containerWidth}px;
        background-color: var(--color-surface-1);
      }
    </style>
  </head>
  <body>
    <div class="email-host"></div>
  </body>
</html>`;
}

function loadFixtures(): EmailFixture[] {
  const fixturesDir = path.join(import.meta.dirname, 'fixtures');

  if (!fs.existsSync(fixturesDir)) {
    return [];
  }

  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

  return files.map((file) => {
    const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
    return JSON.parse(content) as EmailFixture;
  });
}

function snapshotName(args: {
  fixtureName: string;
  themeName: string;
  containerWidth: number;
}): string {
  const themeSuffix = args.themeName.toLowerCase().replace(/\s+/g, '-');
  if (args.containerWidth === DEFAULT_CONTAINER_WIDTH) {
    return `${args.fixtureName}-${themeSuffix}.png`;
  }
  return `${args.fixtureName}-${args.containerWidth}-${themeSuffix}.png`;
}

async function mountEmailBody(args: {
  page: Page;
  html: string;
}): Promise<void> {
  await args.page.locator('.email-host').evaluate(
    (host, next) => {
      const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
      root.replaceChildren();
      const styleEl = document.createElement('style');
      styleEl.textContent = next.css;
      const messageDiv = document.createElement('div');
      messageDiv.innerHTML = next.html;
      root.append(styleEl, messageDiv);
    },
    { css: EMAIL_BODY_CONTAINMENT_CSS, html: args.html }
  );
}

async function applyFitToWidth(page: Page): Promise<void> {
  const host = page.locator('.email-host');
  const measured = await host.evaluate((el) => {
    const message = el.shadowRoot?.querySelector('div');
    if (!(message instanceof HTMLElement)) {
      return undefined;
    }
    return {
      containerWidth: el.clientWidth,
      contentWidth: message.scrollWidth,
    };
  });
  if (!measured) return;
  const fit = fitToWidthZoom(measured);
  if (!fit) return;
  await host.evaluate((el, next) => {
    const message = el.shadowRoot?.querySelector('div');
    if (!(message instanceof HTMLElement)) return;
    message.style.zoom = String(next.zoom);
    if (next.overflowsAfterZoom) {
      message.style.overflowX = 'auto';
    }
  }, fit);
}

const fixtures = loadFixtures();

test.describe('Email Rendering', () => {
  for (const fixture of fixtures) {
    test(fixture.name, async ({ page }, testInfo) => {
      for (const containerWidth of containerWidths(fixture)) {
        await page.setViewportSize({
          width: containerWidth + 64,
          height: 800,
        });

        for (const themeName of THEMES) {
          await page.setContent(createTestHTML({ themeName, containerWidth }));
          await mountEmailBody({
            page,
            html: fixture.body_html_sanitized,
          });
          await page.waitForLoadState('networkidle');
          await applyFitToWidth(page);

          const screenshot = await page.screenshot();
          await testInfo.attach(`${themeName}-${containerWidth}`, {
            body: screenshot,
            contentType: 'image/png',
          });

          await expect(page).toHaveScreenshot(
            snapshotName({
              fixtureName: fixture.name,
              themeName,
              containerWidth,
            })
          );
        }
      }
    });
  }
});
