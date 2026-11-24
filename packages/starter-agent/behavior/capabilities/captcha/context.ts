/**
 * The solver's context: its settings, the agent's current tab, and the
 * browser's driver lease, built once. The only file of the area that
 * touches the world.
 */
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { BrowserPorts } from '../browser/context.ts';
import { captchaConfig } from './config.ts';
import { type Page, withCurrentPage } from './page.ts';

export type CaptchaPorts = {
  readonly config: ReturnType<typeof captchaConfig>;
  /** The browser's DevTools, which the solver's MCP server drives. */
  readonly browserEndpoint: string;
  /** The harness's take-over file (`BrowserConfig.screenDriver`). */
  readonly screenDriver: string;
  readonly withPage: <Value>(
    use: (page: Page) => Promise<Value>
  ) => Promise<Value>;
  readonly driving: BrowserPorts['driving'];
  readonly fetch: (request: Request) => Promise<Response>;
};

const captchaPorts = (base: Base, browser: BrowserPorts): CaptchaPorts => ({
  config: captchaConfig(base),
  browserEndpoint: browser.config.endpoint,
  screenDriver: browser.config.screenDriver,
  withPage: (use) => withCurrentPage(browser.config.endpoint, use),
  driving: browser.driving,
  fetch: (request) => fetch(request),
});

export const captchaContext = (base: Base, browser: BrowserPorts) =>
  behavior<Base>().decorate({ captcha: captchaPorts(base, browser) });

export type CaptchaContext = ContextOf<ReturnType<typeof captchaContext>>;
