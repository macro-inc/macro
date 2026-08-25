const SPLIT_SEGMENT = 'split';
const CHAT_SEGMENT = 'chat';
const INTERNAL_WORKSPACE_PREFIX = ['component', 'agents'] as const;

export const BRAIN_WORKSPACE_ENTRY_STATE_KEY = 'brain.workspace';

export type BrainWorkspaceTab =
  | 'routines'
  | 'skills'
  | 'integrations'
  | 'memory';

export type BrainWorkspaceSelection =
  | { kind: 'tab'; tab: BrainWorkspaceTab }
  | { kind: 'chat'; chatId: string };

export type BrainWorkspaceRoute = {
  selection?: BrainWorkspaceSelection;
  splitSegments: string[];
};

let lastBrainWorkspaceSelection: BrainWorkspaceSelection | undefined;

/** Remember the most recently selected Brain destination for subsequent opens. */
export function rememberBrainWorkspaceSelection(
  selection: BrainWorkspaceSelection | undefined
) {
  lastBrainWorkspaceSelection = selection;
}

/** Return the most recently selected Brain destination in this app session. */
export function getLastBrainWorkspaceSelection() {
  return lastBrainWorkspaceSelection;
}

const BRAIN_TABS = new Set<BrainWorkspaceTab>([
  'routines',
  'skills',
  'integrations',
  'memory',
]);

function completePairs(segments: string[]): string[] {
  return segments.slice(0, segments.length - (segments.length % 2));
}

function decodeSelection(segments: string[]): BrainWorkspaceSelection | undefined {
  if (segments[0] === CHAT_SEGMENT && segments[1]) {
    return { kind: 'chat', chatId: decodeURIComponent(segments[1]) };
  }

  const tab = segments[0] as BrainWorkspaceTab | undefined;
  return tab && BRAIN_TABS.has(tab) ? { kind: 'tab', tab } : undefined;
}

/** Parse the route-owned Brain section or chat and any appended split pairs. */
export function parseBrainWorkspaceRoute(
  brainPath: string | undefined
): BrainWorkspaceRoute {
  const segments = brainPath?.split('/').filter(Boolean) ?? [];
  const splitIndex = segments.indexOf(SPLIT_SEGMENT);
  const selectionSegments =
    splitIndex >= 0 ? segments.slice(0, splitIndex) : segments;
  const splitSegments =
    splitIndex >= 0 ? completePairs(segments.slice(splitIndex + 1)) : [];

  return {
    selection: decodeSelection(selectionSegments),
    splitSegments,
  };
}

/** Build the public Brain workspace URL from its selected section or chat. */
export function buildBrainWorkspacePath(
  selection: BrainWorkspaceSelection | undefined,
  splitSegments: readonly string[] = []
): string {
  const path = ['agents'];
  if (selection?.kind === 'tab') path.push(selection.tab);
  if (selection?.kind === 'chat') {
    path.push(CHAT_SEGMENT, encodeURIComponent(selection.chatId));
  }
  if (splitSegments.length > 0) {
    path.push(SPLIT_SEGMENT, ...splitSegments);
  }
  return `/${path.join('/')}`;
}

/** Retain Brain's route-owned selection while serializing split-manager state. */
export function serializeBrainWorkspacePath(
  managerSegments: readonly string[],
  selection: BrainWorkspaceSelection | undefined
): string {
  const hasWorkspacePrefix =
    managerSegments[0] === INTERNAL_WORKSPACE_PREFIX[0] &&
    managerSegments[1] === INTERNAL_WORKSPACE_PREFIX[1];

  if (!hasWorkspacePrefix) return `/${managerSegments.join('/')}`;

  return buildBrainWorkspacePath(
    selection,
    managerSegments.slice(INTERNAL_WORKSPACE_PREFIX.length)
  );
}

/** Validate a selection restored from split entry state. */
export function isBrainWorkspaceSelection(
  value: unknown
): value is BrainWorkspaceSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Partial<BrainWorkspaceSelection>;
  if (selection.kind === 'chat') {
    return typeof selection.chatId === 'string' && selection.chatId.length > 0;
  }
  return (
    selection.kind === 'tab' &&
    typeof selection.tab === 'string' &&
    BRAIN_TABS.has(selection.tab as BrainWorkspaceTab)
  );
}
