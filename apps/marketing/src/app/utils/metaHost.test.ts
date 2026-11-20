import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProductionMetaHost } from './metaHost';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('production Meta pixel host', () => {
  it('allows only the production site', () => {
    expect(isProductionMetaHost('macro.com')).toBe(true);
    expect(isProductionMetaHost('www.macro.com')).toBe(true);
    for (const host of [
      'dev.macro.com',
      'staging.macro.com',
      'branch-abc-preview.macro.com',
      'macro-dev.zeta.health',
      'localhost',
      '127.0.0.1',
    ]) {
      expect(isProductionMetaHost(host)).toBe(false);
    }
  });

  it('uses the same allowlist in the pages that load the pixel before the bundle', () => {
    const allowlist =
      "location.hostname === 'macro.com' || location.hostname === 'www.macro.com'";
    for (const file of ['index.html', 'start.html']) {
      const html = readFileSync(resolve(siteRoot, file), 'utf8');
      expect(html).toContain(allowlist);
      expect(html).not.toContain('639142540393286&ev=PageView&noscript=1');
    }
  });
});
