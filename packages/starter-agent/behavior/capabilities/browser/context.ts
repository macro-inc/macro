/**
 * The agent's own browser, for real: the computer's Chromium on its display
 * (the one computer use sees), signed in to what the agent signs in to, run
 * by the image as a service. Each step connects to its newest tab and
 * disconnects; the browser keeps running.
 */
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import { type Tab, withTab } from '@macro-inc/muppet/utilities/browser';
import type { Base } from '../../context/index.ts';
import { type BrowserConfig, browserConfig } from './config.ts';

export type BrowserPorts = {
  readonly config: BrowserConfig;
  /** Runs `use` on the newest tab of the agent's browser. */
  readonly withTab: <Value>(
    use: (tab: Tab) => Promise<Value>
  ) => Promise<Value>;
};

export const browserPorts = (base: Base): BrowserPorts => {
  const config = browserConfig(base);
  return {
    config,
    withTab: (use) => withTab(config.endpoint, use),
  };
};

/** What the browser adds to the agent's context. */
export const browserContext = (base: Base) =>
  behavior<Base>().decorate({ browser: browserPorts(base) });

export type BrowserContext = ContextOf<ReturnType<typeof browserContext>>;
