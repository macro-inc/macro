export type AppLayoutCapabilities = {
  experimentalSurfaces: boolean;
  usesNewInbox: boolean;
  usesMessagesWorkspace: boolean;
  usesBrainWorkspace: boolean;
  usesCalendarWorkspace: boolean;
  /**
   * The app chrome — V3's top bar or V4's rail — owns search, create and view
   * switching, so a lone split drops its duplicate chrome and the in-view
   * tabs give up Tab and the digits.
   */
  chromeOwnsViewControls: boolean;
  /**
   * Splits run edge to edge and are divided by a hairline seam rather than
   * floating as rounded, shadowed cards over the page.
   */
  flatSplitSeams: boolean;
  /**
   * The layout's home is a centered AI chat, ChatGPT-style: the app lands on
   * the chat workspace instead of the inbox, and the empty workspace centers
   * its composer mid-screen.
   */
  aiChatHome: boolean;
  /** The inbox pane offers Signal and Noise only, with no All tab. */
  focusedInboxTabs: boolean;
  /** Inbox cards collapse to one line: icon, title, timestamp. */
  singleLineInboxCards: boolean;
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
      chromeOwnsViewControls: false,
      flatSplitSeams: false,
      aiChatHome: false,
      focusedInboxTabs: false,
      singleLineInboxCards: false,
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
      chromeOwnsViewControls: false,
      flatSplitSeams: false,
      aiChatHome: false,
      focusedInboxTabs: false,
      singleLineInboxCards: false,
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
      chromeOwnsViewControls: false,
      flatSplitSeams: false,
      aiChatHome: false,
      focusedInboxTabs: false,
      singleLineInboxCards: false,
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
      chromeOwnsViewControls: true,
      flatSplitSeams: true,
      aiChatHome: false,
      focusedInboxTabs: false,
      singleLineInboxCards: false,
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
      chromeOwnsViewControls: true,
      flatSplitSeams: true,
      aiChatHome: true,
      focusedInboxTabs: true,
      singleLineInboxCards: true,
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
