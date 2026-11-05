/**
 * The artifact block: app chrome (header, sharing, versions, publisher
 * notice) around the artifact view. The only module that reads block state.
 */

import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import {
  type BlockTool,
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal, blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import IconShared from '@icon/share.svg';
import AppWindow from '@icon/system/regular/app-window.svg';
import ClockCounterClockwise from '@icon/system/regular/clock-counter-clockwise.svg';
import FileIcon from '@icon/system/regular/file.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { PublisherNotice } from './components/publisher-notice';
import { OVERVIEW_TAB } from './components/scene-switcher';
import {
  formatVersionTime,
  VersionMenu,
  type VersionRow,
} from './components/version-menu';
import { isOutsideOwnerTeam, SCENE_PARAM, selectScene } from './core/scenes';
import { useArtifactQuery, useArtifactVersionsQuery } from './queries/artifact';
import { ArtifactView } from './views/artifact-view';

const authorName = (userId: string) => getDisplayName(tryMacroId(userId));

export default function ArtifactBlock() {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const canEdit = useCanEdit();
  const name = useBlockDocumentName('Artifact');
  const viewerId = useUserId();
  const team = useCurrentTeamQuery();

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScene = () => {
    const scene = searchParams[SCENE_PARAM];
    return typeof scene === 'string' && scene ? scene : undefined;
  };
  const selectSceneParam = (scene: string | undefined) =>
    setSearchParams({ [SCENE_PARAM]: scene }, { replace: true });
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      const scene = params[SCENE_PARAM];
      selectSceneParam(typeof scene === 'string' ? scene : undefined);
    },
  });

  const [viewedVersion, setViewedVersion] = createSignal<number>();

  const artifact = useArtifactQuery(() => documentId);
  const current = () =>
    artifact.isSuccess ? artifact.data.current : undefined;
  const versions = useArtifactVersionsQuery(
    () => documentId,
    () => artifact.isSuccess
  );
  const versionRows = (): VersionRow[] =>
    versions.isSuccess
      ? versions.data.versions.map((version) => ({
          number: version.number,
          message: version.message ?? undefined,
          author: authorName(version.created_by),
          createdAt: version.created_at,
        }))
      : [];
  const scenes = () => current()?.scenes ?? [];
  const scene = () => selectScene(scenes(), requestedScene());

  const owner = () => blockMetadataSignal()?.owner;
  const userGenerated = () => {
    const ownerId = owner();
    if (!ownerId) return false;
    const members = team.isSuccess
      ? (team.data?.members.map((member) => member.user_id) ?? [])
      : [];
    return isOutsideOwnerTeam(ownerId, viewerId(), members);
  };
  const publisher = () => {
    const version = current();
    return version ? authorName(version.created_by) : '';
  };

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'artifact',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: owner(),
  }));
  const copyEntityLink = useCopyLink();
  const copyLink = () => {
    const selected = scene();
    fireAndForget(
      copyEntityLink(
        buildSimpleEntityUrl(
          { type: 'artifact', id: documentId },
          selected ? { [SCENE_PARAM]: selected } : undefined
        )
      ),
      'artifact-top-bar'
    );
  };

  // Duplicating a document doesn't copy its versions, so artifacts can't.
  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'moveToProject' },
    { op: 'delete' },
  ];

  const tools = (): BlockTool[] => [
    // Desktop shows the version menu in the header instead.
    ...(isTouchDevice() && versionRows().length > 0
      ? [
          {
            label: t('artifacts.versions'),
            icon: ClockCounterClockwise,
            action: () => {},
            children: versionRows().map((version) => ({
              label: t('artifacts.versionAt', {
                number: version.number,
                time: formatVersionTime(version.createdAt),
              }),
              icon: ClockCounterClockwise,
              action: () => setViewedVersion(version.number),
            })),
          },
        ]
      : []),
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      buttonComponent: () => (
        <ShareTrigger onClick={openShare} copyLink={copyLink} />
      ),
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  // Phones and tablets have no room for scene tabs; the title menu leads
  // with them instead.
  const mobileScenes = () =>
    scenes().length > 0
      ? {
          title: t('artifacts.scenes'),
          options: [
            {
              value: OVERVIEW_TAB,
              label: t('artifacts.overview'),
              icon: AppWindow,
            },
            ...scenes().map((option) => ({
              value: option.id,
              label: option.title,
              icon: FileIcon,
            })),
          ],
          value: scene() ?? OVERVIEW_TAB,
          onSelect: (value: string) =>
            selectSceneParam(value === OVERVIEW_TAB ? undefined : value),
        }
      : undefined;

  return (
    <DocumentBlockContainer>
      <div class="flex size-full flex-col overflow-hidden">
        <SidePanel.Layout defaultOpen={false} floating>
          <FileSidePanelSections />
          <div class="flex size-full min-w-0 flex-col overflow-hidden">
            <SplitHeaderLeft>
              <BlockItemSplitLabel
                badges={
                  <PublisherNotice
                    publisher={publisher()}
                    userGenerated={userGenerated()}
                  />
                }
              />
            </SplitHeaderLeft>
            <Show when={!isTouchDevice() && current()}>
              {(version) => (
                <SplitHeaderRight>
                  <VersionMenu
                    versions={versionRows()}
                    current={version().number}
                    viewed={viewedVersion() ?? version().number}
                    onView={(number) =>
                      setViewedVersion(
                        number === version().number ? undefined : number
                      )
                    }
                  />
                </SplitHeaderRight>
              )}
            </Show>
            <ResponsivePermissionsBadge />
            <ResponsiveBlockToolbar
              tools={tools()}
              ops={ops}
              id={documentId}
              itemType="document"
              name={name()}
              mobileViews={isTouchDevice() ? mobileScenes() : undefined}
            />
            <ArtifactView
              documentId={documentId}
              name={name() ?? ''}
              canEdit={canEdit()}
              requestedScene={requestedScene()}
              onSelectScene={selectSceneParam}
              viewedVersion={viewedVersion()}
              onViewLatest={() => setViewedVersion(undefined)}
            />
          </div>
        </SidePanel.Layout>
      </div>
    </DocumentBlockContainer>
  );
}
