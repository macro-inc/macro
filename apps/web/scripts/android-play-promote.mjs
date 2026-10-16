import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const api =
  'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.macro.workspace.mobile/edits';

export function validateVersionCode(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^[1-9][0-9]{0,9}$/.test(value) ||
    Number(value) > 2_100_000_000
  ) {
    throw new Error('Specify an Android version code between 1 and 2100000000');
  }
  return value;
}

function releasesFor(track, expectedTrack) {
  if (
    track?.track !== expectedTrack ||
    (track.releases !== undefined && !Array.isArray(track.releases))
  ) {
    throw new Error(`Invalid ${expectedTrack} track response`);
  }
  const releases = track.releases ?? [];
  for (const release of releases) {
    if (
      !release ||
      !Array.isArray(release.versionCodes) ||
      release.versionCodes.length === 0
    ) {
      throw new Error(`Missing version codes in ${expectedTrack} track`);
    }
    release.versionCodes.forEach(validateVersionCode);
  }
  return releases;
}

export function productionPromotion(internal, production, versionCode) {
  validateVersionCode(versionCode);
  const sources = releasesFor(internal, 'internal').filter(
    (release) =>
      release.status === 'completed' &&
      release.versionCodes.includes(versionCode)
  );
  if (sources.length !== 1 || sources[0].versionCodes.length !== 1) {
    throw new Error(
      'The exact version must be a completed, single-version release in internal testing'
    );
  }
  const current = releasesFor(production, 'production');
  if (current.some((release) => release.status !== 'completed')) {
    throw new Error(
      'Production has a draft, staged, or halted release; resolve it in Play Console first'
    );
  }
  const currentCodes = current.flatMap((release) => release.versionCodes);
  if (currentCodes.some((code) => Number(code) > Number(versionCode))) {
    throw new Error('A newer version is already in production');
  }
  if (currentCodes.includes(versionCode)) return null;

  const source = sources[0];
  return {
    track: 'production',
    releases: [
      {
        versionCodes: [versionCode],
        status: 'completed',
        ...(source.name !== undefined ? { name: source.name } : {}),
        ...(source.releaseNotes !== undefined
          ? { releaseNotes: source.releaseNotes }
          : {}),
        ...(source.inAppUpdatePriority !== undefined
          ? { inAppUpdatePriority: source.inAppUpdatePriority }
          : {}),
      },
    ],
  };
}

export async function promoteToProduction({
  token,
  versionCode,
  changesNotSentForReview = false,
  request = fetch,
}) {
  validateVersionCode(versionCode);
  if (!token) throw new Error('Missing Google Play access token');
  if (typeof changesNotSentForReview !== 'boolean')
    throw new Error('Invalid review submission option');

  async function call(method, path, body = undefined) {
    const response = await request(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      // Do not dump credentials, request headers, or raw API responses into CI logs.
      throw new Error(
        `Google Play ${method} ${path} failed (HTTP ${response.status})`
      );
    }
    return response.status === 204 ? undefined : response.json();
  }

  const edit = await call('POST', '', {});
  if (typeof edit?.id !== 'string' || !edit.id)
    throw new Error('Google Play did not return an edit ID');
  const editPath = `/${encodeURIComponent(edit.id)}`;
  let committed = false;
  try {
    const internal = await call('GET', `${editPath}/tracks/internal`);
    const production = await call('GET', `${editPath}/tracks/production`);
    const update = productionPromotion(internal, production, versionCode);
    if (update === null) return 'already-production';

    await call('PUT', `${editPath}/tracks/production`, update);
    await call('POST', `${editPath}:validate`);
    // A failed/ambiguous commit is not automatically retried; inspect Console first.
    const result = await call(
      'POST',
      `${editPath}:commit?changesNotSentForReview=${changesNotSentForReview}`
    );
    if (result?.id !== edit.id)
      throw new Error(
        'Google Play did not confirm the committed edit; inspect Play Console'
      );
    committed = true;
    return 'submitted';
  } finally {
    if (!committed) {
      try {
        await call('DELETE', editPath);
      } catch {
        console.warn(
          'Unable to discard the Play edit; inspect Play Console before retrying'
        );
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const reviewOption = process.env.CHANGES_NOT_SENT_FOR_REVIEW ?? 'false';
    if (!['true', 'false'].includes(reviewOption))
      throw new Error('Invalid review submission option');
    const versionCode = validateVersionCode(process.env.VERSION_CODE);
    const result = await promoteToProduction({
      token: process.env.GOOGLE_PLAY_ACCESS_TOKEN,
      versionCode,
      changesNotSentForReview: reviewOption === 'true',
    });
    const summary =
      result === 'already-production'
        ? `Version code ${versionCode} is already in production; no changes made.`
        : `Submitted version code ${versionCode} from internal testing for a full production rollout. Check Play Console for review and publishing status.`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Production promotion failed'
    );
    process.exitCode = 1;
  }
}
