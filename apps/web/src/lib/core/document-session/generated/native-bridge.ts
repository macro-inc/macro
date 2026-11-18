// Generated from schema/bridge.schema.json; do not edit.
/**
 * Source of truth for the Android editor bridge. The root is a type catalog; commands carry
 * their named request, never this catalog.
 */
export interface NativeBridgeTypes {
  accountReply: AccountReply;
  accountRequest: AccountRequest;
  actionRequest: ActionRequest;
  createRequest: CreateRequest;
  focusRequest: FocusRequest;
  layoutRequest: LayoutRequest;
  lifecycleRequest: LifecycleRequest;
  menuCommitRequest: MenuCommitRequest;
  menuRowsRequest: MenuRowsRequest;
  mountRequest: MountRequest;
  permissionRequest: PermissionRequest;
  queryReply: QueryReply;
  queryRequest: QueryRequest;
  surfaceEvent: SurfaceEvent;
  surfacePermissions: SurfacePermissions;
  surfaceScope: SurfaceScope;
  tokenResultRequest: TokenResultRequest;
  unmountRequest: UnmountRequest;
}

export interface AccountReply {
  accountGeneration: number;
}

export interface AccountRequest {
  user: string;
}

export interface ActionRequest {
  kind: ActionRequestKind;
  modelGeneration: number;
  name: string;
  payloadJson?: string;
  revision?: number;
  scope: SurfaceScope;
}

export type ActionRequestKind = 'application' | 'command' | 'setState';

export interface SurfaceScope {
  accountGeneration: number;
  surfaceGeneration: number;
  surfaceId: string;
}

export interface CreateRequest {
  access: CreateRequestAccess;
  documentId: string;
  durable: boolean;
  hostname?: string;
  permissions: SurfacePermissions;
  presenceColor: PresenceColor;
  presenceRefreshMs?: number;
  presenceTimeoutMs: number;
  presenceUserId?: string;
  preset: Preset;
  scope: SurfaceScope;
  sessionId: string;
  snapshotBase64: string;
  snapshotIntervalMs: number;
  traceparent?: string;
  transport: Transport;
  user: string;
}

export type CreateRequestAccess = 'read' | 'comment' | 'edit';

export interface SurfacePermissions {
  canComment: boolean;
  canWrite: boolean;
  contentInteractable: boolean;
  current: boolean;
  editorEditable: boolean;
}

export type PresenceColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'purple'
  | 'pink';

export type Preset =
  | 'plainText'
  | 'title'
  | 'markdown'
  | 'markdownSync'
  | 'chat'
  | 'calendar';

export type Transport = 'none' | 'direct';

export interface FocusRequest {
  focused: boolean;
  mountGeneration: number;
  scope: SurfaceScope;
}

export interface LayoutRequest {
  clipBottom: number;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  height: number;
  left: number;
  mountGeneration: number;
  scope: SurfaceScope;
  top: number;
  viewportWidth: number;
  visible: boolean;
  width: number;
}

export interface LifecycleRequest {
  scope: SurfaceScope;
  signal: Signal;
}

export type Signal = 'visible' | 'hidden' | 'online' | 'pageHide';

export interface MenuCommitRequest {
  choice: MenuChoice;
  identity: MenuIdentity;
  rowId: string;
  scope: SurfaceScope;
}

export interface MenuChoice {
  agentSession?: MenuAgentSession;
  block?: Block;
  bookingLink?: MenuBookingLink;
  date?: MenuDate;
  document?: MenuDocument;
  groupAlias?: string;
  kind: ChoiceKind;
  snippetNodesJson?: string;
  text?: string;
  user?: MenuUser;
}

export interface MenuAgentSession {
  id: string;
  label?: string;
  mentionUuid?: string;
}

export type Block =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'quote'
  | 'code'
  | 'link'
  | 'bullet'
  | 'number'
  | 'check';

export interface MenuBookingLink {
  label?: string;
  profileId?: string;
  slug?: string;
  url: string;
}

export interface MenuDate {
  date: string;
  displayFormat: string;
  mentionUuid?: string;
}

export interface MenuDocument {
  blockName: string;
  blockParams?: { [key: string]: string };
  channelType?: string;
  collapsed?: boolean;
  createdAt?: number;
  documentId: string;
  documentName: string;
  mentionUuid?: string;
}

export type ChoiceKind =
  | 'text'
  | 'user'
  | 'document'
  | 'date'
  | 'group'
  | 'agent-session'
  | 'booking-link'
  | 'block'
  | 'snippet';

export interface MenuUser {
  displayName: string;
  email?: string;
  mentionUuid?: string;
  userId: string;
}

export interface MenuIdentity {
  invocation: number;
  modelGeneration: number;
  mountGeneration: number;
  queryGeneration: number;
}

export interface MenuRowsRequest {
  buckets: MenuBucket[];
  identity: MenuIdentity;
  rejectedRowId?: string;
  rows: MenuRow[];
  scope: SurfaceScope;
}

export interface MenuBucket {
  error?: string;
  hasMore: boolean;
  id: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  label: string;
  loadedCount: number;
}

export interface MenuRow {
  bucketId: string;
  detail?: string;
  disabled?: boolean;
  id: string;
  label: string;
}

export interface MountRequest {
  ariaLabel: string;
  darkMode: boolean;
  fontSizeCssPx: number;
  hintColorArgb: number;
  lineHeightCssPx: number;
  mountGeneration: number;
  placeholder: string;
  scope: SurfaceScope;
  textColorArgb: number;
}

export interface PermissionRequest {
  permissions: SurfacePermissions;
  scope: SurfaceScope;
}

export interface QueryReply {
  json: string;
}

export interface QueryRequest {
  kind: QueryRequestKind;
  modelGeneration: number;
  name?: string;
  payloadJson?: string;
  scope: SurfaceScope;
}

export type QueryRequestKind =
  | 'text'
  | 'markdown'
  | 'state'
  | 'savedState'
  | 'selectedMarkdown'
  | 'clipboard'
  | 'application';

export interface SurfaceEvent {
  canRedo?: boolean;
  canUndo?: boolean;
  kind: SurfaceEventKind;
  menu?: MenuEvent;
  message?: string;
  modelGeneration: number;
  name?: string;
  payloadJson?: string;
  requestId?: number;
  revision: number;
  scope: SurfaceScope;
}

export type SurfaceEventKind =
  | 'ready'
  | 'changed'
  | 'history'
  | 'status'
  | 'plugin'
  | 'token'
  | 'stopped'
  | 'error'
  | 'telemetry'
  | 'menu';

export interface MenuEvent {
  action: Action;
  bucketId?: string;
  query: MenuQuery;
  rowId?: string;
}

export type Action = 'query' | 'select' | 'more' | 'closed';

export interface MenuQuery {
  identity: MenuIdentity;
  kind: QueryKind;
  nodeTypes: string[];
  selectedIndex: number;
  term: string;
}

export type QueryKind = 'mention' | 'action' | 'snippet' | 'emoji';

export interface TokenResultRequest {
  access: TokenResultRequestAccess;
  requestId: number;
  scope: SurfaceScope;
  socketUrl?: string;
  token?: string;
}

export type TokenResultRequestAccess = 'none' | 'commentMarks' | 'full';

export interface UnmountRequest {
  mountGeneration: number;
  scope: SurfaceScope;
}
