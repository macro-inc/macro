import type { ReportedWorkspace } from '@service-storage/generated/schemas/reportedWorkspace';
import { match } from 'ts-pattern';

/** The option id for "no workspace of its own": use the next level down. */
export const DEFAULT_WORKSPACE_OPTION = 'default';

export type WorkspaceOption = { id: string; name: string };

/**
 * The workspaces a runtime's daemon reported, as select options after the
 * default. A saved workspace the daemon no longer reports stays listed, so
 * the picker never silently shows something else.
 */
export function workspaceOptions(
  reported: readonly ReportedWorkspace[],
  saved: string | null | undefined,
  defaultLabel: string
): WorkspaceOption[] {
  const options: WorkspaceOption[] = [
    { id: DEFAULT_WORKSPACE_OPTION, name: defaultLabel },
    ...reported.map((workspace) => ({
      id: workspace.path,
      name: match(workspace.kind)
        .with('allowed_root', () => `${workspace.path} (allowed root)`)
        .with('repository', () => workspace.path)
        .exhaustive(),
    })),
  ];
  if (saved && !reported.some((workspace) => workspace.path === saved)) {
    options.push({ id: saved, name: `${saved} (no longer reported)` });
  }
  return options;
}

/** The saved workspace path for a picked option id. */
export function workspacePathFor(optionId: string): string | undefined {
  return optionId === DEFAULT_WORKSPACE_OPTION ? undefined : optionId;
}
