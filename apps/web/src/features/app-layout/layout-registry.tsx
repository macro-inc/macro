export type AppLayoutCapabilities = {
  experimentalSurfaces: boolean;
  usesNewInbox: boolean;
  usesMessagesWorkspace: boolean;
  usesBrainWorkspace: boolean;
  usesCalendarWorkspace: boolean;
  usesFloatingSplitClose: boolean;
  hidesGlobalSidebar: boolean;
  compactSplitHeader: boolean;
  removesSplitContentLeftPadding: boolean;
  removesSplitContentTopPadding: boolean;
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
      usesFloatingSplitClose: false,
      hidesGlobalSidebar: false,
      compactSplitHeader: false,
      removesSplitContentLeftPadding: false,
      removesSplitContentTopPadding: false,
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
      usesFloatingSplitClose: false,
      hidesGlobalSidebar: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
      removesSplitContentTopPadding: false,
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
      usesFloatingSplitClose: false,
      hidesGlobalSidebar: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
      removesSplitContentTopPadding: false,
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
      usesFloatingSplitClose: true,
      hidesGlobalSidebar: false,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
      removesSplitContentTopPadding: true,
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
    id: 'experimental-v5',
    label: 'Experimental v5',
    splitPanelRenderer: 'v2-composed',
    capabilities: {
      experimentalSurfaces: true,
      usesNewInbox: true,
      usesMessagesWorkspace: true,
      usesBrainWorkspace: true,
      usesCalendarWorkspace: true,
      usesFloatingSplitClose: true,
      hidesGlobalSidebar: true,
      compactSplitHeader: true,
      removesSplitContentLeftPadding: true,
      removesSplitContentTopPadding: true,
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

export function getAppLayoutDefinition(
  id: AppLayoutId
): AppLayoutDefinition {
  return APP_LAYOUTS_BY_ID.get(id) ?? APP_LAYOUT_DEFINITIONS[0];
}
