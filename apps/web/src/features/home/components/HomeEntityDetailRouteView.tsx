import {
  EntityDetail,
  type EntityDetailContext,
  entityDetailBlockType,
} from '@app/components/entity-detail/EntityDetail';
import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import { createSearchParams, useParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { useMarkdownName } from '@block-md/component/MarkdownNameProvider';
import { useMarkdownDocumentTools } from '@block-md/component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '@block-md/context/markdown-document-context';
import { ChannelDetailTopBar } from '@channel/Channel/ChannelDetail';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewBlockTarget } from '@components/app/previewTarget';
import { SidePanel } from '@components/app/side-panel';
import {
  type FileOperation,
  SplitFileMenu,
} from '@components/app/split-layout/components/SplitFileMenu';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { getPermissions, Permissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useDocumentShareModal } from '@core/component/TopBar/shareModal';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import {
  type Accessor,
  createMemo,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { isHomeDocumentType } from '../home-route-schema';
import { useHomeView } from '../home-view-context';
import { HomeReturnBreadcrumb } from './HomeReturnBreadcrumb';

type DetailParams = {
  channelId?: string;
  documentType?: string;
  documentId?: string;
};

function HomeEntityBreadcrumb(props: {
  name: Accessor<string | undefined>;
  target: EntityDetailTarget;
  value: Accessor<string>;
  fileMenu?: JSX.Element;
}) {
  useSplitDisplayName(props.name);

  return (
    <ViewBreadcrumbs.Item
      value={props.value()}
      metadata={props.target}
      order={1}
    >
      {(item) => (
        <div class="flex min-w-0 items-center">
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={props.name()}
          >
            <EntityIcon
              targetType={entityDetailBlockType(props.target) ?? 'channel'}
              size="xs"
              class="shrink-0"
            />
            <span class="truncate">{props.name()}</span>
          </ViewBreadcrumbs.Button>
          <Show when={props.fileMenu}>
            <div class="shrink-0">{props.fileMenu}</div>
          </Show>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function HomeMarkdownBreadcrumb(props: {
  target: EntityDetailTarget;
  value: Accessor<string>;
}) {
  const { displayName } = useMarkdownName();
  const { documentId, kind, permissions } = useMarkdownDocument();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();
  const blockType = () => {
    const documentKind = kind();
    return documentKind === 'document' ? 'md' : documentKind;
  };
  const name = () => displayName() || blockNameToDefaultFile(blockType());
  const menuPermissions = () => {
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  return (
    <HomeEntityBreadcrumb
      name={name}
      target={props.target}
      value={props.value}
      fileMenu={
        <SplitFileMenu
          id={documentId()}
          itemType="document"
          name={name()}
          ops={fileOperations}
          tools={menuTools}
          entityKind={blockType()}
          permissions={menuPermissions()}
        />
      }
    />
  );
}

type HomeDocumentContext = Extract<EntityDetailContext, { type: 'document' }>;

function HomeDocumentBreadcrumb(props: {
  context: HomeDocumentContext;
  target: EntityDetailTarget;
  value: Accessor<string>;
}) {
  const blockType = () => entityDetailBlockType(props.target) ?? 'unknown';
  const name = () =>
    props.context.documentMetadata.documentName ||
    blockNameToDefaultFile(blockType());
  const fileOperations = (): FileOperation[] => [
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    ...(props.context.operations ?? []),
    { op: 'delete' },
  ];

  return (
    <HomeEntityBreadcrumb
      name={name}
      target={props.target}
      value={props.value}
      fileMenu={
        <SplitFileMenu
          id={props.context.documentMetadata.documentId}
          itemType="document"
          name={name()}
          ops={fileOperations()}
          entityKind={blockType()}
          permissions={getPermissions(props.context.userAccessLevel)}
        />
      }
    />
  );
}

/** The shared details that can render without a legacy block instance. */
function entityDetailTarget(
  params: DetailParams,
  preview: PreviewBlockTarget | undefined
): EntityDetailTarget | undefined {
  if (!preview) return;
  if (params.channelId && preview.blockType === 'channel') {
    const location = preview.params as Record<string, unknown> | undefined;
    const messageId = location?.[CHANNEL_URL_PARAMS.message];
    const threadId = location?.[CHANNEL_URL_PARAMS.thread];
    return {
      type: 'channel',
      id: params.channelId,
      ...(typeof messageId === 'string'
        ? {
            target: {
              messageId,
              ...(typeof threadId === 'string' ? { threadId } : {}),
            },
          }
        : {}),
    };
  }

  const { documentType, documentId } = params;
  if (
    !documentType ||
    !documentId ||
    !isHomeDocumentType(documentType) ||
    documentType === 'spreadsheet' ||
    documentType === 'unknown' ||
    preview.params
  ) {
    // The shared file details do not yet navigate to document comments.
    return;
  }
  const subType =
    documentType === 'task' ||
    documentType === 'snippet' ||
    documentType === 'skill'
      ? { type: documentType }
      : undefined;
  return {
    type: 'document',
    id: documentId,
    fileType: subType ? 'md' : documentType === 'csv' ? 'code' : documentType,
    ...(subType ? { subType } : {}),
  };
}

function HomeEntityDetailBody(props: {
  target: EntityDetailTarget;
  value: Accessor<string>;
  navigationRequest: number | string;
}) {
  const panel = useSplitPanelOrThrow();
  const documentShareTarget = () => {
    const blockAlias = entityDetailBlockType(props.target);
    return props.target.type === 'document' && blockAlias
      ? { documentId: props.target.id, blockAlias }
      : undefined;
  };
  const openShare = useDocumentShareModal(documentShareTarget);

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Show when={props.target.type !== 'channel'}>
        <ViewShell.TopBar class="touch:flex">
          <ViewBreadcrumbs.Outlet aria-label="Home location" />
          <div class="ml-auto flex items-center gap-1">
            <SidePanel.HeaderActionsOutlet />
            <Show when={documentShareTarget()}>
              {(target) => (
                <ShareTrigger
                  onClick={openShare}
                  id={target().documentId}
                  blockType={target().blockAlias}
                  hotkeyScope={panel.splitHotkeyScope}
                />
              )}
            </Show>
            <SidePanel.Toggle />
          </div>
        </ViewShell.TopBar>
      </Show>
      <div class="relative min-h-0 min-w-0 flex-1">
        <EntityDetail
          target={props.target}
          navigationRequest={props.navigationRequest}
          routeOwned
        >
          {(context) => {
            const name = () => {
              switch (context.type) {
                case 'channel':
                  return context.name();
                case 'document':
                  return (
                    context.documentMetadata.documentName ||
                    blockNameToDefaultFile(entityDetailBlockType(props.target))
                  );
              }
            };
            const channel = () =>
              context.type === 'channel' ? context : undefined;
            const document = () =>
              context.type === 'document' ? context : undefined;
            const blockType = entityDetailBlockType(props.target);
            const isMarkdown =
              context.type === 'document' &&
              (blockType === 'md' ||
                blockType === 'task' ||
                blockType === 'snippet' ||
                blockType === 'skill');

            return (
              <>
                <Show
                  when={isMarkdown}
                  fallback={
                    <Show
                      when={document()}
                      fallback={
                        <HomeEntityBreadcrumb
                          name={name}
                          target={props.target}
                          value={props.value}
                        />
                      }
                    >
                      {(current) => (
                        <HomeDocumentBreadcrumb
                          context={current()}
                          target={props.target}
                          value={props.value}
                        />
                      )}
                    </Show>
                  }
                >
                  <HomeMarkdownBreadcrumb
                    target={props.target}
                    value={props.value}
                  />
                </Show>
                <Show when={channel()}>
                  {(current) => (
                    <ChannelDetailTopBar
                      channelId={current().channelId}
                      leading={
                        <ViewBreadcrumbs.Outlet aria-label="Channel location" />
                      }
                    />
                  )}
                </Show>
              </>
            );
          }}
        </EntityDetail>
      </div>
    </div>
  );
}

function HomeDirectDetail(props: {
  target: EntityDetailTarget;
  closePreview: () => void;
  navigationRequest: number | string;
}) {
  const value = () => `${props.target.type}:${props.target.id}`;

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'home') props.closePreview();
      }}
    >
      <ViewBreadcrumbs.Item value="home" metadata={null} order={0}>
        {(item) => (
          <ViewBreadcrumbs.ReturnButton onClick={item.onSelect}>
            Home
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <SidePanel.Root>
        <HomeEntityDetailBody
          target={props.target}
          value={value}
          navigationRequest={props.navigationRequest}
        />
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

/** Home's typed channel and document routes; unsupported locations keep the block preview. */
export function HomeEntityDetailRouteView() {
  const params = useParams<DetailParams>();
  const [search] = createSearchParams(channelsSearch);
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { previewTarget, previewNavigationRequest, closePreview } =
    useHomeView();
  const detail = createMemo(() => entityDetailTarget(params, previewTarget()));

  return (
    <Switch>
      <Match when={detail()}>
        {(target) => (
          <HomeDirectDetail
            target={target()}
            closePreview={closePreview}
            navigationRequest={`${previewNavigationRequest()}:${search.seek}`}
          />
        )}
      </Match>
      <Match when={true}>
        <PreviewPanel
          target={previewTarget()}
          navigationRequest={previewNavigationRequest()}
          routeOwned
          orchestrator={orchestrator}
          splitPanelContext={panel}
          headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
        />
      </Match>
    </Switch>
  );
}
