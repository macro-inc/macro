import {
  EntityDetail,
  entityDetailBlockType,
} from '@app/components/entity-detail/EntityDetail';
import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import { createSearchParams, useParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { ChannelDetailTopBar } from '@channel/Channel/ChannelDetail';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import type { PreviewBlockTarget } from '@components/app/previewTarget';
import { SidePanel } from '@components/app/side-panel';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useDocumentShareModal } from '@core/component/TopBar/shareModal';
import { useCopyLink } from '@core/util/useCopyLink';
import { type Accessor, createMemo, Match, Show, Switch } from 'solid-js';
import { isHomeDocumentType } from '../home-route-schema';
import { useHomeView } from '../home-view-context';
import { HomeReturnBreadcrumb } from './HomeReturnBreadcrumb';

type DetailParams = {
  channelId?: string;
  documentType?: string;
  documentId?: string;
};

function HomeEntityDisplayName(props: { name: Accessor<string | undefined> }) {
  useSplitDisplayName(props.name);
  return null;
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
  const copyViewLink = useCopyLink();
  const copyLink = () => copyViewLink(window.location.href);

  const documentDetail = createMemo(() => {
    const target = props.target;
    if (target.type !== 'document') return;
    const blockType = entityDetailBlockType(target);
    return blockType ? { target, blockType } : undefined;
  });

  const openShare = useDocumentShareModal(() => {
    const detail = documentDetail();
    if (!detail) return;
    return {
      documentId: detail.target.id,
      blockAlias: detail.blockType,
      copyLink,
    };
  });

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Show when={props.target.type !== 'channel'}>
        <ViewShell.TopBar>
          <ViewBreadcrumbs.Outlet aria-label="Home location" />
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Show when={documentDetail()}>
              {(detail) => (
                <ShareTrigger
                  onClick={openShare}
                  id={detail().target.id}
                  blockType={detail().blockType}
                  hotkeyScope={panel.splitHotkeyScope}
                  copyLink={copyLink}
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
        >
          {(context) => {
            const name = () => {
              switch (context.type) {
                case 'channel':
                  return context.name();
                case 'document':
                  return context.documentMetadata.documentName;
              }
            };
            const channel = () =>
              context.type === 'channel' ? context : undefined;

            return (
              <>
                <HomeEntityDisplayName name={name} />
                <ViewBreadcrumbs.Item
                  value={props.value()}
                  metadata={props.target}
                  order={1}
                >
                  {(item) => (
                    <ViewBreadcrumbs.Button
                      isActive={item.isActive()}
                      onClick={item.onSelect}
                      tooltip={name()}
                    >
                      <span class="truncate">{name()}</span>
                    </ViewBreadcrumbs.Button>
                  )}
                </ViewBreadcrumbs.Item>
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
          orchestrator={orchestrator}
          splitPanelContext={panel}
          headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
        />
      </Match>
    </Switch>
  );
}
