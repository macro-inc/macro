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
