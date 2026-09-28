import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import IconShared from '@icon/share.svg';
import { onMount, Show } from 'solid-js';
import { isGameKind } from './core/catalog';
import type { GameData } from './definition';
import { AppGamesProvider } from './games';
import { useGamesAccess } from './games-access';
import { createGameRoom } from './primitives/create-game-room';
import { createGameSession } from './queries/game-session';
import { GameRoomView } from './views/game-room-view';

type GameBlockProps = {
  /** Opens the share dialog on arrival, as other native documents do. */
  share?: string;
  /** The game requested when the room was created. */
  kind?: string;
};

export default function GameBlock(props: GameBlockProps) {
  const enabled = useGamesAccess();
  return (
    <Show
      when={enabled()}
      fallback={
        <div class="p-6 text-ink-muted">
          Games are not enabled for this account.
        </div>
      }
    >
      <GameBlockContent share={props.share} kind={props.kind} />
    </Show>
  );
}

/**
 * The block adapter: reads the legacy block state once and hands identity,
 * permissions and the sync source to the game room explicitly.
 */
function GameBlockContent(props: GameBlockProps) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('New Game');
  const canEdit = useCanEdit();
  const userId = useUserId();
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'game',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  onMount(() => {
    if (props.share === 'true') openShare();
  });
  const data = () => {
    const value = blockDataSignal.get() as
      | (GameData & { __block?: string })
      | undefined;
    return value?.__block === 'game' ? value : undefined;
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderLeft>
          <BlockItemSplitLabel />
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <BlockLiveIndicators />
        </SplitHeaderRight>
        <ResponsivePermissionsBadge />
        <ResponsiveBlockToolbar
          id={documentId}
          itemType="document"
          name={name()}
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
              buttonComponent: () => <ShareTrigger onClick={openShare} />,
              focusTarget: getShareDrawerRecipientInput,
            },
          ]}
        />
        <Show when={data()?.syncSource} keyed>
          {(syncSource) => {
            const source = createGameSession({
              documentId,
              userId: userId(),
              canEdit,
              syncSource,
              doInitialSync: data()!.doInitialSync,
            });
            const room = createGameRoom({
              source,
              userId,
              canEdit,
              requestedKind: () =>
                isGameKind(props.kind) ? props.kind : undefined,
            });
            return (
              <AppGamesProvider>
                <GameRoomView room={room} documentId={documentId} />
              </AppGamesProvider>
            );
          }}
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
