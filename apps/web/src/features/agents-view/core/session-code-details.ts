/** The persisted coding context rendered beneath an agent conversation. */
export type SessionCodeDetails = {
  repository?: string;
  branch?: string;
  pullRequest?: {
    number: number;
    url: string;
    status?: 'open' | 'draft' | 'merged' | 'closed';
  };
};

/** Accept repository URLs and SSH remotes without displaying credentials. */
export function repositoryLabel(url: string | null | undefined) {
  if (!url) return undefined;
  const remote = url.trim();
  const ssh = remote.match(/^[^/@\s]+@[^/:\s]+:(.+)$/);
  try {
    const path = ssh?.[1] ?? new URL(remote).pathname;
    return path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') || undefined;
  } catch {
    return undefined;
  }
}
