/** The URL parameter that names the open scene. */
export const SCENE_PARAM = 'scene';

/** More scenes than this switch from tabs to a select. */
export const MAX_SCENE_TABS = 6;

/**
 * The scene to show: the requested one when the version has it, otherwise
 * none, which shows the artifact's `index.html`.
 */
export function selectScene(
  scenes: readonly { id: string }[],
  requested: string | undefined
): string | undefined {
  if (!requested) return undefined;
  return scenes.some((scene) => scene.id === requested) ? requested : undefined;
}

export type SceneSwitcher = 'none' | 'tabs' | 'select';

export function sceneSwitcher(sceneCount: number): SceneSwitcher {
  if (sceneCount === 0) return 'none';
  return sceneCount > MAX_SCENE_TABS ? 'select' : 'tabs';
}

/**
 * Whether to tell a viewer the page is user-generated: anyone but the owner
 * and members of the viewer's team that the owner belongs to.
 */
export function isOutsideOwnerTeam(
  owner: string,
  viewer: string | undefined,
  viewerTeamMemberIds: readonly string[]
): boolean {
  if (viewer === owner) return false;
  return !viewerTeamMemberIds.includes(owner);
}
