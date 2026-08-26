export type AppLayoutCapabilities = {
  experimentalSurfaces: boolean;
  usesNewInbox: boolean;
  usesMessagesWorkspace: boolean;
  usesBrainWorkspace: boolean;
  usesCalendarWorkspace: boolean;
  /** App chrome is a horizontal bar above the splits instead of a sidebar. */
  usesTopBar: boolean;
  /**
   * App chrome is a floating dock hovering over the bottom of the splits,
   * Fey-style, instead of a sidebar or top bar.
   */
  usesBottomBar: boolean;
  /**
   * Splits run edge to edge and are divided by a hairline seam rather than
   * floating as rounded, shadowed cards over the page.
   */
  flatSplitSeams: boolean;
  compactSplitHeader: boolean;
  removesSplitContentLeftPadding: boolean;
};

export type AppLayoutDefinition = {
  id: string;
  label: string;
  splitPanelRenderer: 'legacy' | 'v2-composed';
  capabilities: AppLayoutCapabilities;
  contentOwnedSplitChrome: ReadonlySet<string>;
  experimentalViewNames?: Readonly<Record<string, string>>;
};

const NO_CONTENT_OWNED_CHROME = new Set<string>();
const V2_CONTENT_OWNED_CHROME = new Set([
  'activity',
  'agents',
  'companies',
  'documents',
  'inbox',
  'mail',
  'tasks',
]);

export const APP_LAYOUT_DEFINITIONS = [
  {
    id: 'classic',
    label: 'Classic',
    splitPanelRenderer: 'legacy',
    capabilities: {
      experimentalSurfaces: false,
      usesNewInbox: false,
      usesMessagesWorkspace: false,
      usesBrainWorkspace: false,
      usesCalendarWorkspace: false,
      usesTopBar: false,
      usesBottomBar: false,
      flatSplitSeams: false,
      compactSplitHeader: false,
      removesSplitContentLeftPadding: false,
    },
    contentOwnedSplitChrome: NO_CONTENT_OWNED_CHROME,
  },
  {
    id: 'experimental-v1',
    label: 'Experimental v1',
    splitPanelRenderer: 'legacy',
    capabilities: {
      experimentalSurfaces: true,
      usesNewInbox: true,
      usesMessagesWorkspace: true,
      usesBrainWorkspace: false,
      usesCalendarWorkspace: false,
      usesTopBar: false,
      usesBottomBar: false,
      flatSplitSeams: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
    },
    contentOwnedSplitChrome: NO_CONTENT_OWNED_CHROME,
    experimentalViewNames: {
      machines: 'Powers',
      messages: 'Messages',
    },
  },
  {
    id: 'experimental-v2',
    label: 'Experimental v2',
    splitPanelRenderer: 'v2-composed',
    capabilities: {
      experimentalSurfaces: true,
      usesNewInbox: true,
      usesMessagesWorkspace: true,
      usesBrainWorkspace: true,
      usesCalendarWorkspace: true,
      usesTopBar: false,
      usesBottomBar: false,
      flatSplitSeams: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
    },
    contentOwnedSplitChrome: V2_CONTENT_OWNED_CHROME,
    experimentalViewNames: {
      crm: 'CRM',
      library: 'Drive',
      machines: 'Brain',
      messages: 'Chat',
    },
  },
  {
    id: 'experimental-v3',
    label: 'Experimental v3',
    splitPanelRenderer: 'v2-composed',
    capabilities: {
      experimentalSurfaces: true,
      usesNewInbox: true,
      usesMessagesWorkspace: true,
      usesBrainWorkspace: true,
      usesCalendarWorkspace: true,
      usesTopBar: true,
      usesBottomBar: false,
      flatSplitSeams: true,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
    },
    contentOwnedSplitChrome: V2_CONTENT_OWNED_CHROME,
    experimentalViewNames: {
      crm: 'CRM',
      library: 'Drive',
      machines: 'Brain',
      messages: 'Chat',
    },
  },
  {
    id: 'experimental-v4',
    label: 'Experimental v4',
    splitPanelRenderer: 'v2-composed',
    capabilities: {
      experimentalSurfaces: true,
      usesNewInbox: true,
      usesMessagesWorkspace: true,
      usesBrainWorkspace: true,
      usesCalendarWorkspace: true,
      // The dock carries no search field or view title, so the splits keep
      // their own chrome — only the top bar takes those over.
      usesTopBar: false,
      usesBottomBar: true,
      // V2's bento: the dock floats over a page of rounded, shadowed cards
      // rather than over one edge-to-edge sheet.
      flatSplitSeams: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
    },
    contentOwnedSplitChrome: V2_CONTENT_OWNED_CHROME,
    experimentalViewNames: {
      crm: 'CRM',
      library: 'Drive',
      machines: 'Brain',
      messages: 'Chat',
    },
  },
] as const satisfies readonly AppLayoutDefinition[];

/** Registered ids are inferred from the registry, so future layouts add one entry. */
export type AppLayoutId = (typeof APP_LAYOUT_DEFINITIONS)[number]['id'];

const APP_LAYOUTS_BY_ID = new Map<AppLayoutId, AppLayoutDefinition>(
  APP_LAYOUT_DEFINITIONS.map(
    (definition) => [definition.id, definition] as const
  )
);

export function isAppLayoutId(value: unknown): value is AppLayoutId {
  return APP_LAYOUTS_BY_ID.has(value as AppLayoutId);
}

export function getAppLayoutDefinition(id: AppLayoutId): AppLayoutDefinition {
  return APP_LAYOUTS_BY_ID.get(id) ?? APP_LAYOUT_DEFINITIONS[0];
}
