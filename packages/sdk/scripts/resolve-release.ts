/**
 * Decide whether a push to `main` publishes, for the `Release SDK` workflow.
 * Writes `release`, `version`, `tag`, and `dist_tag` to `$GITHUB_OUTPUT`.
 */
import { publishedVersions, readManifest, resolveRelease } from './release';

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

const manifest = await readManifest();
const resolution = resolveRelease(
  manifest.version,
  await publishedVersions(manifest.name),
);

switch (resolution.kind) {
  case 'published':
    console.log(
      `${manifest.name}@${resolution.version} is already published; nothing to release.`,
    );
    await emit({ release: 'false', version: resolution.version });
    break;
  case 'rejected':
    await emit({ release: 'false', version: resolution.version });
    throw new Error(resolution.reason);
  case 'release':
    console.log(
      `releasing ${manifest.name}@${resolution.version} as '${resolution.distTag}'`,
    );
    await emit({
      release: 'true',
      version: resolution.version,
      tag: resolution.tag,
      dist_tag: resolution.distTag,
    });
    break;
}
