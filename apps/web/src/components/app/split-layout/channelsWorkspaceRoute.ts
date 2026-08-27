const SPLIT_SEGMENT = 'split';
const INTERNAL_WORKSPACE_PREFIX = ['component', 'channels'] as const;

export type ChannelsWorkspaceRoute = {
  selectedChannelId?: string;
  splitSegments: string[];
};

function completePairs(segments: string[]): string[] {
  return segments.slice(0, segments.length - (segments.length % 2));
}

/** Parse the route-owned channel selection and any appended split pairs. */
export function parseChannelsWorkspaceRoute(
  channelsPath: string | undefined
): ChannelsWorkspaceRoute {
  const segments = channelsPath?.split('/').filter(Boolean) ?? [];
  const splitIndex = segments.indexOf(SPLIT_SEGMENT);

  if (splitIndex === 0) {
    const splitSegments = segments.slice(1);
    return { splitSegments: completePairs(splitSegments) };
  }

  if (splitIndex > 0) {
    const splitSegments = segments.slice(splitIndex + 1);
    return {
      selectedChannelId: segments[0],
      splitSegments: completePairs(splitSegments),
    };
  }

  return {
    selectedChannelId: segments[0],
    splitSegments: [],
  };
}

/** Build the public Messages workspace URL from its route-owned state. */
export function buildChannelsWorkspacePath(
  selectedChannelId: string | undefined,
  splitSegments: readonly string[] = []
): string {
  const path = ['channels'];
  if (selectedChannelId) path.push(encodeURIComponent(selectedChannelId));
  if (splitSegments.length > 0) {
    path.push(SPLIT_SEGMENT, ...splitSegments);
  }
  return `/${path.join('/')}`;
}

/**
 * Serialize internal split-manager segments while retaining the Messages
 * workspace's compact `/channels/:id` prefix.
 */
export function serializeChannelsWorkspacePath(
  managerSegments: readonly string[],
  selectedChannelId: string | undefined
): string {
  const hasWorkspacePrefix =
    managerSegments[0] === INTERNAL_WORKSPACE_PREFIX[0] &&
    managerSegments[1] === INTERNAL_WORKSPACE_PREFIX[1];

  if (!hasWorkspacePrefix) return `/${managerSegments.join('/')}`;

  return buildChannelsWorkspacePath(
    selectedChannelId,
    managerSegments.slice(INTERNAL_WORKSPACE_PREFIX.length)
  );
}
