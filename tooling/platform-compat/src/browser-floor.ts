import type { BrowserName } from '@mdn/browser-compat-data';
import webPackage from '../../../apps/web/package.json' with { type: 'json' };

/** Compatibility-data ids for the browserslist names the web app may target. */
const COMPAT_BROWSERS: Readonly<Record<string, BrowserName>> = {
  safari: 'safari',
  ios_saf: 'safari_ios',
  chrome: 'chrome',
  and_chr: 'chrome_android',
  edge: 'edge',
  firefox: 'firefox',
};

/** The oldest version of each browser the code must run on. */
export type BrowserFloor = ReadonlyMap<BrowserName, string>;

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index++
  ) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Parses `browser >= version` queries, the only form apps/web/vite.base.ts can map to esbuild targets. */
export function parseBrowserFloor(queries: readonly string[]): BrowserFloor {
  const floor = new Map<BrowserName, string>();
  for (const query of queries) {
    const match = /^(\w+) >= (\d+(?:\.\d+)?)$/.exec(query);
    const browser = match ? COMPAT_BROWSERS[match[1]] : undefined;
    if (!match || !browser) {
      throw new Error(`Unsupported browserslist query: ${query}`);
    }
    floor.set(browser, match[2]);
  }
  return floor;
}

export const WEB_BROWSER_FLOOR = parseBrowserFloor(webPackage.browserslist);
