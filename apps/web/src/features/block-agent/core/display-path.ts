/**
 * Show a tool-call path relative to the session workspace.
 *
 * Session workspaces are the harness cwd (`/workspace` on the managed
 * sandbox). Absolute paths under that root print as repo-relative
 * (`apps/web/foo.ts`); anything else is left alone.
 */
export function displayPath(path: string, workspace?: string): string {
  if (workspace == null || workspace.length === 0) return path;
  const root = workspace.replace(/\/+$/, '');
  if (root.length === 0) return path;
  if (path === root || path === `${root}/`) return '.';
  const prefix = `${root}/`;
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return path;
}

export function displayPaths(paths: string[], workspace?: string): string[] {
  return paths.map((path) => displayPath(path, workspace));
}
