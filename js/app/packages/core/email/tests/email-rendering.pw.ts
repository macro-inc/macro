import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_THEMES } from '../../../block-theme/constants';
import type { ThemeColorParams } from '../transform-email-colors';

// =============================================================================
// Types
// =============================================================================

/**
 * Email fixture format - matches the structure from email service.
 *
 * ## Adding a new fixture:
 * 1. Create a JSON file in the fixtures/ directory (e.g., `my-email.json`)
 * 2. Copy `body_html_sanitized` from an email API response into the file
 * 3. Run `just test-email-rendering-update` to generate baseline screenshots
 * 4. Commit the fixture and snapshots
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
}

// =============================================================================
// Configuration
// =============================================================================

/** Themes to test - uses actual Macro theme definitions */
const THEMES = ['Macro Dark', 'Macro Light'] as const;

// =============================================================================
// Theme Helpers
// =============================================================================

function getThemeConfig(themeName: string): ThemeColorParams {
  const theme = DEFAULT_THEMES.find((t) => t.name === themeName);
  if (!theme) {
    throw new Error(`Theme "${themeName}" not found in DEFAULT_THEMES`);
  }
  return {
    inkL: theme.tokens.c0.l,
    inkC: theme.tokens.c0.c,
    inkH: theme.tokens.c0.h,
    panelL: theme.tokens.b1.l,
    accentL: theme.tokens.a0.l,
    accentC: theme.tokens.a0.c,
    accentH: theme.tokens.a0.h,
  };
}

function generateThemeCSS(themeName: string): string {
  const theme = DEFAULT_THEMES.find((t) => t.name === themeName);
  if (!theme) return '';

  const vars = Object.entries(theme.tokens)
    .map(
      ([key, value]) =>
        `--${key}l: ${value.l}; --${key}c: ${value.c}; --${key}h: ${value.h}deg;`
    )
    .join('\n    ');

  return `:root {\n    ${vars}\n  }`;
}

// =============================================================================
// HTML Generation
// =============================================================================

function createTestHTML(fixture: EmailFixture, themeName: string): string {
  const themeCSS = generateThemeCSS(themeName);
  const theme = getThemeConfig(themeName);
  const bgColor = `oklch(${theme.panelL} 0 0)`;
  const textColor = `oklch(${theme.inkL} ${theme.inkC} ${theme.inkH})`;

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
        background-color: ${bgColor};
        color: ${textColor};
        padding: 16px;
      }

      .email-container {
        max-width: 600px;
        width: 100%;
        padding: 16px;
        background-color: ${bgColor};
      }

      /* Default link styling using accent color */
      a {
        color: oklch(${theme.accentL} ${theme.accentC} ${theme.accentH});
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      ${fixture.body_html_sanitized}
    </div>
  </body>
</html>`;
}

// =============================================================================
// Fixture Loading
// =============================================================================

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

// =============================================================================
// Snapshot Naming
// =============================================================================

function snapshotName(fixtureName: string, themeName: string): string {
  const themeSuffix = themeName.toLowerCase().replace(/\s+/g, '-');
  return `${fixtureName}-${themeSuffix}.png`;
}

// =============================================================================
// Tests
// =============================================================================

const fixtures = loadFixtures();

test.describe('Email Rendering', () => {
  for (const fixture of fixtures) {
    test(fixture.name, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 700, height: 800 });

      for (const themeName of THEMES) {
        const html = createTestHTML(fixture, themeName);
        await page.setContent(html);
        await page.waitForLoadState('networkidle');

        // Attach screenshot to report (visible even for passing tests)
        const screenshot = await page.screenshot();
        await testInfo.attach(`${themeName}`, {
          body: screenshot,
          contentType: 'image/png',
        });

        await expect(page).toHaveScreenshot(
          snapshotName(fixture.name, themeName)
        );
      }
    });
  }
});
