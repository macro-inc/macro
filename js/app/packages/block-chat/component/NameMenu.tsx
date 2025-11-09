import { copyChat } from '@block-chat/client';
import type { ChatData } from '@block-chat/definition';
import { LocationType, useCreateShareUrl } from '@block-pdf/signal/location';
import { withAnalytics } from '@coparse/analytics';
import { useIsAuthenticated } from '@core/auth';
import { EditableProvider } from '@core/component/Editable';
import {
  DropdownMenuContent,
  MenuItem,
  MenuItemRenameTrigger,
  MenuSeparator,
} from '@core/component/Menu';
import { EditingTextButton, TextButton } from '@core/component/TextButton';
import { BarContext } from '@core/component/TopBar/Bar';
import { setCachedInputStore } from '@core/store/cacheChatInput';
import { isErr } from '@core/util/maybeResult';
import Unpin from '@icon/fill/push-pin-slash-fill.svg';
import CopySimple from '@icon/regular/copy-simple.svg';
import PencilSimpleLine from '@icon/regular/pencil-simple-line.svg';
import Pin from '@icon/regular/push-pin.svg';
import ShareFat from '@icon/regular/share-fat.svg';
import TrashSimple from '@icon/regular/trash-simple.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { useEmail } from '@service-gql/client';
import {
  refetchHistory,
  useUpdatedDssItemName,
} from '@service-storage/history';
import {
  pinItem,
  refetchPins,
  unpinItem,
  usePinnedIds,
} from '@service-storage/pins';
import { refetchResources } from '@service-storage/util/refetchResources';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { useSplitPanelOrThrow } from 'app/component/split-layout/layoutUtils';
import { toast } from 'core/component/Toast/Toast';
import { createMemo, createSignal, Show, useContext } from 'solid-js';

const { track, TrackingEvents } = withAnalytics();

type Props = { data: ChatData };

export function ChatNameMenu(props: Props) {
  const [chatMenuOpen, setChatMenuOpen] = createSignal(false);
  const isAuthenticated = useIsAuthenticated();
  const pinnedIds = usePinnedIds();
  const panelContext = useSplitPanelOrThrow();

  const isPinned = createCallback(() => {
    return pinnedIds().includes(props.data.chat.id);
  });

  const mutatePin = (
    ...params: Parameters<typeof pinItem & typeof unpinItem>
  ) => {
    if (isPinned()) {
      return unpinItem(...params);
    }

    return pinItem(...params);
  };
  const renameChat = async ({
    chat_id,
    new_name,
  }: {
    chat_id: string;
    new_name: string;
  }) => {
    if (!new_name.trim()) return toast.alert('Chat name cannot be empty');

    const maybeRenameResult = await cognitionApiServiceClient.renameChat({
      chat_id,
      new_name,
    });
    if (isErr(maybeRenameResult)) return;

    if (isPinned()) refetchPins();

    refetchHistory();
  };
  const deleteChat = async (chat_id: string) => {
    setCachedInputStore(chat_id, undefined);
    const maybeDeletedChat = await cognitionApiServiceClient.deleteChat({
      chat_id,
    });
    if (isErr(maybeDeletedChat)) return;

    if (isPinned()) refetchPins();

    refetchResources();
    panelContext?.handle.close();
  };
  const navigate = useNavigate();

  const updatedDssItemName = useUpdatedDssItemName(props.data.chat.id);

  const chatName = createMemo(() => {
    const updatedDssName = updatedDssItemName();
    const fallbackName = props.data.chat.name ?? 'Untitled Chat';

    if (updatedDssName) return updatedDssName;

    return fallbackName;
  });

  const context = useContext(BarContext);
  if (!context) throw new Error('ChatNameMenu must be used within a Bar');
  const truncation = context.truncation;

  const truncatedName = () => {
    const name = chatName();
    if (!name) return 'Untitled Chat';
    const maxLength = truncation().stage.fileNameLength;
    return name.length > maxLength
      ? `${name.slice(0, maxLength - 3)}...`
      : name;
  };
  const email = useEmail();
  const isChatOwner = () => email() === props.data.chat.userId;
  const createShareUrl = useCreateShareUrl();

  return (
    <EditableProvider
      editingComponent={
        <EditingTextButton
          handleSubmitEdit={(new_name) => {
            renameChat({ chat_id: props.data.chat.id, new_name });
          }}
          labelText={chatName() ?? ''}
          theme="clear"
          dynamicSizing
          showChevron
        />
      }
    >
      <DropdownMenu
        open={chatMenuOpen()}
        onOpenChange={setChatMenuOpen}
        sameWidth
      >
        <DropdownMenu.Trigger>
          <TextButton theme="clear" showChevron tabIndex={-1}>
            {truncatedName()}
          </TextButton>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenuContent>
            <Show when={isAuthenticated()}>
              <MenuItem
                text={isPinned() ? `Unpin` : 'Pin'}
                icon={isPinned() ? Unpin : Pin}
                onClick={() => {
                  mutatePin('chat', props.data.chat.id);
                  track(TrackingEvents.BLOCKCHAT.CHATMENU.FAVORITE);
                }}
              />
            </Show>
            <MenuItem
              text={'Make a Copy'}
              icon={CopySimple}
              onClick={async () => {
                const result = await copyChat({
                  id: props.data.chat.id,
                  name: props.data.chat.name + ' Copy',
                }).catch((_) => {});
                if (result?.href) navigate(result.href);
              }}
            />
            <Show when={isAuthenticated() && isChatOwner()}>
              <MenuItemRenameTrigger
                text="Rename"
                icon={PencilSimpleLine}
                sideEffect={() => setChatMenuOpen(false)}
              />
            </Show>
            <MenuSeparator />
            <MenuItem
              text={'Share'}
              icon={ShareFat}
              onClick={async () => {
                createShareUrl(LocationType.General);
                track(TrackingEvents.BLOCKCHAT.CHATMENU.SHARE);
                toast.success('Link copied to clipboard');
              }}
            />
            <Show when={isAuthenticated() && isChatOwner()}>
              <MenuSeparator />
              <MenuItem
                text={'Delete'}
                icon={TrashSimple}
                onClick={async () => {
                  deleteChat(props.data.chat.id);
                  track(TrackingEvents.BLOCKCHAT.CHATMENU.DELETE);
                }}
              />
            </Show>
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </EditableProvider>
  );
}
