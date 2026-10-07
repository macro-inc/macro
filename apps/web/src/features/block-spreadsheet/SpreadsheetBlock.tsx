import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { claimOf, useOptionalSplitRouter } from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import { ResponsiveBlockToolbar } from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useIsAuthenticated } from '@core/auth';
import {
  EntityLoadGate,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { LiveIndicators } from '@core/component/LiveIndicators';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { track } from '@core/internal/trackBlockOpened';
import { isMobile } from '@core/mobile/isMobile';
import { useUserIndicators } from '@core/state/liveIndicators';
import { getDisplayName, tryMacroId } from '@core/user';
import { createRenameDssEntityMutation } from '@entity';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import { useQueryClient } from '@queries/client';
import { useItemRawName } from '@queries/preview';
import { useEntitySubscription } from '@service-connection/client';
import { createSyncServiceSource } from '@service-sync/source';
import { Badge } from '@ui';
import {
  createEffect,
  createResource,
  on,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import { spreadsheetChatContext } from './core/chat-context';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { useSpreadsheetAccess } from './primitives/use-spreadsheet-access';
import {
  loadSpreadsheetDocument,
  type SpreadsheetDocumentData,
} from './queries/spreadsheet-document';
import { createSpreadsheetSession } from './queries/spreadsheet-session';
import { SpreadsheetComments } from './SpreadsheetComments';
import { spreadsheetMentions } from './spreadsheet-mentions';
import {
  spreadsheetDetailSearch,
  spreadsheetDetailSearchCodec,
  spreadsheetLocationParams,
} from './spreadsheet-route';
import { SpreadsheetEditor } from './views/SpreadsheetEditor';

export type SpreadsheetBlockProps = {
  documentId: string;
  params?: Record<string, string>;
  navigationRequest?: number | string;
  share?: string;
  nested?: boolean;
  routeOwned?: boolean;
};

/** Direct spreadsheet composition. The loaded view owns its live sync session. */
export default function SpreadsheetBlock(props: SpreadsheetBlockProps) {
  const enabled = useSpreadsheetAccess();
  return (
    <Show
      when={enabled()}
      fallback={
        <div class="p-6 text-ink-muted">
          Spreadsheets are not enabled for this account.
        </div>
      }
    >
      <Show when={props.documentId} keyed>
        {(documentId) => <SpreadsheetLoad {...props} documentId={documentId} />}
      </Show>
    </Show>
  );
}

function SpreadsheetLoad(props: SpreadsheetBlockProps) {
  const [document, { refetch }] = createResource(
    () => props.documentId,
    loadSpreadsheetDocument
  );
  const data = () =>
    document.state === 'ready' || document.state === 'refreshing'
      ? document.latest
      : undefined;
  const result = {
    data,
    error: () => toEntityLoadError(document.error),
    isPending: () =>
      document.state === 'pending' || document.state === 'unresolved',
  };
  return (
    <EntityLoadGate
      result={result}
      onRetry={() => void refetch()}
      loadErrorTitle="Unable to load this spreadsheet"
    >
      <Show when={data()} keyed>
        {(data) => <SpreadsheetDocument {...props} data={data} />}
      </Show>
    </EntityLoadGate>
  );
}

function SpreadsheetDocument(
  props: SpreadsheetBlockProps & { data: SpreadsheetDocumentData }
) {
  const panel = useSplitPanel();
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const localScope = props.nested || !panel;
  const [attachScope, scopeId] = localScope
    ? useHotkeyDOMScope('spreadsheet')
    : ([undefined, panel.splitHotkeyScope] as const);
  const params = createParamsState();
  const router = useOptionalSplitRouter();
  const pane = useContext(PaneContext);
  const routeLocation = () => {
    if (!props.routeOwned || !router || !pane) return;
    const entry = pane.entry();
    if (
      !entry ||
      claimOf(router.routes, entry.location.route) !==
        `block:spreadsheet:${props.documentId}`
    )
      return;
    const raw = entry.location.search?.[spreadsheetDetailSearch.namespace];
    if (!raw) return;
    const parsed = spreadsheetDetailSearchCodec.parse(raw);
    if (!parsed.valid || parsed.value.documentId !== props.documentId) return;
    return parsed.value;
  };
  const routeParams = () =>
    spreadsheetLocationParams({
      comment_id: routeLocation()?.commentId,
      share: routeLocation()?.share,
    });
  createEffect(
    on(
      () =>
        props.routeOwned
          ? ([
              routeLocation()?.commentId,
              routeLocation()?.share,
              routeLocation()?.seek,
              props.documentId,
            ] as const)
          : ([props.params, props.navigationRequest] as const),
      () =>
        params.navigate(
          props.routeOwned
            ? routeParams()
            : spreadsheetLocationParams(props.params)
        )
    )
  );
  const permissions = () => getPermissions(props.data.userAccessLevel);
  const authenticated = useIsAuthenticated();
  const canEdit = () =>
    Boolean(authenticated()) &&
    hasPermissions(permissions(), Permissions.CAN_EDIT);
  const canComment = () =>
    Boolean(authenticated()) &&
    hasPermissions(permissions(), Permissions.CAN_COMMENT);
  const isOwner = () => hasPermissions(permissions(), Permissions.OWNER);
  const userId = useUserId();
  const updatedName = useItemRawName(() => ({
    type: 'document',
    id: props.documentId,
  }));
  const name = () =>
    updatedName() ||
    props.data.documentMetadata.documentName ||
    'New Spreadsheet';
  const rename = createRenameDssEntityMutation();
  const entity = () => ({
    type: 'document' as const,
    id: props.documentId,
    name: name(),
    fileType: 'spreadsheet' as const,
    ownerId: props.data.documentMetadata.owner,
  });
  useBlockEntityCommands({
    id: props.documentId,
    scopeId,
    resolveEntity: entity,
  });
  useEntitySubscription(() => ({
    entity_type: 'document',
    entity_id: props.documentId,
  }));
  const analytics = useAnalytics();
  const client = useQueryClient();
  onMount(() => {
    if (props.nested) return;
    track({
      itemId: props.documentId,
      blockName: 'spreadsheet',
      client: () => client,
    });
    analytics.pageView('spreadsheet');
    analytics.track('open_entity', {
      entityType: 'spreadsheet',
      entityId: props.documentId,
    });
  });
  const { source: syncSource, doInitialSync } = createSyncServiceSource(
    props.documentId,
    props.data.token,
    props.data.authorization
  );
  const source = createSpreadsheetSession({
    documentId: props.documentId,
    userId: userId(),
    canEdit,
    syncSource,
    doInitialSync,
  });
  const store = createSpreadsheetStore({
    source: {
      ...source,
      peers: () =>
        source.peers().map((peer) => ({
          ...peer,
          name: getDisplayName(tryMacroId(peer.userId ?? ''), {
            emailFallback: 'local-part',
          }),
        })),
    },
    canEdit,
  });
  const indicators = useUserIndicators(() => props.documentId);
  const openShare = useShareModal(() => ({
    id: props.documentId,
    blockAlias: 'spreadsheet',
    itemType: 'document',
    name: name(),
    userPermissions: permissions(),
    owner: props.data.documentMetadata.owner,
  }));
  createEffect(
    on(
      () =>
        props.routeOwned
          ? ([routeLocation()?.share, routeLocation()?.seek] as const)
          : ([
              props.share ?? props.params?.share,
              props.navigationRequest,
            ] as const),
      ([share]) => {
        if (share === 'true') openShare();
      }
    )
  );
  const chrome = () => Boolean(panel) && !props.nested;

  return (
    <ParamsProvider
      state={params}
      urlParams={
        props.routeOwned
          ? routeParams()
          : spreadsheetLocationParams(props.params)
      }
    >
      <div
        class="portal-scope relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
        data-block-type="spreadsheet"
        tabindex={-1}
        ref={(element) => {
          attachScope?.(element);
        }}
      >
        <Show when={chrome()}>
          <SplitHeaderLeft>
            <StaticSplitLabel
              label={name()}
              iconType="spreadsheet"
              onRename={
                isOwner()
                  ? (newName) => rename.mutate({ entity: entity(), newName })
                  : undefined
              }
              badges={
                <Show when={!isMobile()}>
                  <Badge variant="outline" size="xs">
                    Beta
                  </Badge>
                </Show>
              }
            />
          </SplitHeaderLeft>
          <SplitHeaderRight>
            <Show when={ENABLE_LIVE_INDICATORS}>
              <LiveIndicators
                userIds={indicators() ?? []}
                currentUserId={userId()}
              />
            </Show>
            <div class="order-[999] flex items-center">
              <ChatWithAgentButton
                label="Ask Macro"
                disabled={!store.ready()}
                entity={{
                  ...entity(),
                  blockParams: spreadsheetChatContext(
                    store.activeSheet(),
                    store.selection()
                  ),
                }}
              />
            </div>
          </SplitHeaderRight>
          <ResponsiveBlockToolbar
            entityKind="spreadsheet"
            id={props.documentId}
            itemType="document"
            name={name()}
            entity={entity()}
            permissions={permissions()}
            ops={[
              { op: 'rename' },
              { op: 'copy' },
              { op: 'moveToProject' },
              { op: 'delete' },
            ]}
            tools={[
              {
                group: 'sharing',
                label: 'Share',
                icon: IconShared,
                action: openShare,
                buttonComponent: () => (
                  <ShareTrigger
                    id={props.documentId}
                    blockType="spreadsheet"
                    hotkeyScope={scopeId}
                    onClick={openShare}
                  />
                ),
                focusTarget: getShareDrawerRecipientInput,
              },
            ]}
          />
        </Show>
        <SpreadsheetComments
          documentId={props.documentId}
          store={store}
          canComment={canComment}
          isOwner={isOwner}
          showHeader={chrome()}
        >
          {(commentLocation, comments) => (
            <SpreadsheetEditor
              autoFocus={!props.nested && canAutofocus && !navigatedFromJK()}
              commentLocation={commentLocation()}
              comments={comments}
              mentions={spreadsheetMentions}
              store={store}
              name={name()}
              onExportXlsx={(bytes) =>
                downloadFile(
                  new Blob([bytes.slice().buffer], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  }),
                  `${name()}.xlsx`
                )
              }
              onExport={(content) =>
                downloadFile(
                  new Blob([content], { type: 'text/csv;charset=utf-8' }),
                  `${name()}.csv`
                )
              }
            />
          )}
        </SpreadsheetComments>
      </div>
    </ParamsProvider>
  );
}
