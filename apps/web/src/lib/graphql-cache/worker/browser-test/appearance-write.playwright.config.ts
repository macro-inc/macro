import { defineConfig } from '@playwright/test';
import cacheBrowserConfig from './playwright.config';

const config = defineConfig(cacheBrowserConfig, {
  testMatch: 'appearance-write.browser.e2e.ts',
  expect: { timeout: 15_000 },
});
if (config.webServer && !Array.isArray(config.webServer)) {
  config.webServer.timeout = 600_000;
  config.webServer.command += ' --force';
}

export default config;
