import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, safeFetch } from '@core/util/safeFetch';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

/** Public repository metadata; never send Macro credentials to GitHub. */
export async function getMacroGithubStars(
  signal?: AbortSignal
): Promise<number> {
  const response = await fetch('https://api.github.com/repos/macro-inc/macro', {
    credentials: 'omit',
    signal,
  });
  if (!response.ok) throw new Error('Unable to load GitHub stars');
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    !('stargazers_count' in data) ||
    typeof data.stargazers_count !== 'number' ||
    !Number.isSafeInteger(data.stargazers_count) ||
    data.stargazers_count < 0
  )
    throw new Error('Invalid GitHub star count');
  return data.stargazers_count;
}

const MACRO_RELEASES_URL =
  'https://api.github.com/repos/macro-inc/macro/releases?per_page=100';

const releasesSchema = z.array(
  z.object({
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    assets: z
      .array(z.object({ name: z.string(), browser_download_url: z.string() }))
      .optional(),
  })
);

type MacroRelease = z.infer<typeof releasesSchema>[number];

type ReleasesErrorCode = BaseFetchErrorCode | 'INVALID_RESPONSE';

/** The repository's newest releases, newest first; sent without credentials. */
export async function listMacroReleases(
  signal?: AbortSignal
): Promise<Result<MacroRelease[], ResultError<ReleasesErrorCode>[]>> {
  const response = await safeFetch<unknown[]>(MACRO_RELEASES_URL, {
    credentials: 'omit',
    signal,
  });
  if (response.isErr()) return err(response.error);

  const releases = releasesSchema.safeParse(response.value);
  if (!releases.success)
    return err([
      { code: 'INVALID_RESPONSE', message: 'Unexpected GitHub releases list' },
    ]);
  return ok(releases.data);
}
