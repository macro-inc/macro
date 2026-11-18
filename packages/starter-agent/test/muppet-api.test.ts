/**
 * This code runs on the muppet its computer's image ships: it may need no
 * higher muppet API (`muppetApi` here) than that muppet has (`apiLevel`).
 * Checked against the muppet this checkout resolves, which in the monorepo
 * is the one the next image is built from.
 */
import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const root = join(import.meta.dir, '..');
const Needs = z.object({ muppetApi: z.number().int().nonnegative() });
const Has = z.object({ apiLevel: z.number().int().nonnegative() });

test('the code needs no higher muppet API than the muppet it runs on has', async () => {
  const muppet = join(
    dirname(Bun.resolveSync('@macro-inc/muppet/core/agent', root)),
    '..',
    'package.json'
  );
  const { muppetApi } = Needs.parse(
    JSON.parse(await Bun.file(join(root, 'package.json')).text())
  );
  const { apiLevel } = Has.parse(JSON.parse(await Bun.file(muppet).text()));
  expect(muppetApi).toBeLessThanOrEqual(apiLevel);
});
