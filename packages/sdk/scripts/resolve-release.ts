/**
 * Decide whether a push to `main` publishes, for the `Release SDK` workflow.
 * Writes `release`, `version`, `tag`, and `dist_tag` for `@macro-inc/sdk`, and
 * the same names prefixed `calls_` for `@macro-inc/sdk-calls`, to `$GITHUB_OUTPUT`.
 */
import { match } from 'ts-pattern';
import {
  firstPublishProblem,
  lockstepProblem,
  publishedVersions,
  type Resolution,
  readCallsManifest,
  readManifest,
  resolveRelease,
} from './release';

async function emit(outputs: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  if (file === undefined) {
    console.log(body.trimEnd());
    return;
  }
  await Bun.write(
    file,
    (await Bun.file(file)
      .text()
      .catch(() => '')) + body,
  );
}

const sdk = await readManifest();
const calls = await readCallsManifest();

const problem = lockstepProblem(sdk, calls);
if (problem !== undefined) throw new Error(problem);

const sdkPublished = await publishedVersions(sdk.name);
const callsPublished = await publishedVersions(calls.name);

for (const [name, published] of [
  [sdk.name, sdkPublished],
  [calls.name, callsPublished],
] as const) {
  const firstPublish = firstPublishProblem(name, published);
  if (firstPublish !== undefined) throw new Error(firstPublish);
}

const sdkResolution = resolveRelease(sdk.version, sdkPublished);
const callsResolution = resolveRelease(
  calls.version,
  callsPublished,
  'sdk-calls',
);

// Each package resolves on its own, so re-running after one published and the
// other failed publishes only what's missing.
function outputs(
  name: string,
  prefix: string,
  resolution: Resolution,
): Record<string, string> {
  return match(resolution)
    .with({ kind: 'published' }, ({ version }) => {
      console.log(
        `${name}@${version} is already published; nothing to release.`,
      );
      return { [`${prefix}release`]: 'false', [`${prefix}version`]: version };
    })
    .with({ kind: 'rejected' }, ({ reason }) => {
      throw new Error(`${name}: ${reason}`);
    })
    .with({ kind: 'release' }, ({ version, tag, distTag }) => {
      console.log(`releasing ${name}@${version} as '${distTag}'`);
      return {
        [`${prefix}release`]: 'true',
        [`${prefix}version`]: version,
        [`${prefix}tag`]: tag,
        [`${prefix}dist_tag`]: distTag,
      };
    })
    .exhaustive();
}

await emit({
  ...outputs(sdk.name, '', sdkResolution),
  ...outputs(calls.name, 'calls_', callsResolution),
});
