import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { useChannelMarkdownArea } from '@block-channel/component/MarkdownArea';
import { useBlockId, useBlockName } from '@core/block';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { CombinedRecipientItem, WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { buildSimpleEntityUrl } from '@core/util/url';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import type { PointerDownOutsideEvent } from '@kobalte/core/primitives/create-interact-outside';
import PaperPlaneIcon from '@phosphor-icons/core/regular/paper-plane-tilt.svg?component-solid';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { createSignal, type JSXElement, Show, type Signal } from 'solid-js';
import type { ItemMention } from './LexicalMarkdown/plugins';
import { TextButton } from './TextButton';
import { toast } from './Toast/Toast';

type NewMessageProps = {
  // source of where we are making the new message
  source: 'block' | 'menu';
  title: string;
  trigger?: JSXElement;
  isOpenSignal?: Signal<boolean>;
};

type UserDestination = {
  type: 'users';
  users: string[];
};

type ChannelDestination = {
  type: 'channel';
  id: string;
};

type Destination = UserDestination | ChannelDestination;

type DestinationType<T extends CombinedRecipientItem> =
  T extends CombinedRecipientItem<'channel'>
    ? Extract<T, CombinedRecipientItem<'channel'>> extends T
      ? ChannelDestination // T is ONLY channel
      : Destination // T includes channel and others
    : // T excludes channel
      UserDestination;

function CopyLinkButton() {
  const blockName = useBlockName();
  const blockId = useBlockId();

  function handleCopyLink() {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl(
        {
          type: blockName,
          id: blockId,
        },
        {}
      )
    );
    toast.success('Link copied to clipboard');
  }

  return <TextButton text="Copy Link" theme="base" onClick={handleCopyLink} />;
}

export function getDestinationFromOptions<T extends CombinedRecipientItem>(
  options: T[]
): DestinationType<T> {
  let maybeChannel = options.find((o) => o.kind === 'channel');
  if (maybeChannel) {
    return {
      type: 'channel',
      id: maybeChannel.id,
    } as any;
  }

  const userIds = options
    .filter((o) => {
      if (o.kind === 'custom') {
        return !o.data.invalid;
      }
      return true;
    })
    .map((o) => {
      if (o.kind === 'channel') return;
      return o.id;
    })
    .filter((id) => id != null);

  return {
    type: 'users',
    users: userIds,
  } as any;
}

function mentionToSimpleMention(mention: ItemMention): SimpleMention {
  return {
    entity_type: mention.itemType,
    entity_id: mention.itemId,
  };
}

export function NewMessage(props: NewMessageProps) {
  const { all: destinationOptions } = useCombinedRecipients();
  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);

  const {
    focus: focusMarkdownArea,
    state: markdownState,
    mentions,
    formatState: markdownFormatState,
    setInlineFormat,
    setNodeFormat,
    MarkdownArea,
  } = useChannelMarkdownArea();

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();
  const asAttachment =
    props.source === 'block'
      ? { entity_type: useBlockName(), entity_id: useBlockId() }
      : undefined;

  function handleSubmit() {
    let options_ = selectedOptions();
    if (!options_ || options_.length === 0) {
      setTriedToSubmit(true);
      return;
    }
    const destination_ = getDestinationFromOptions(options_);
    if (!destination_) return;
    if (destination_.type === 'users') {
      sendToUsers({
        users: destination_.users,
        content: markdownState(),
        attachments: asAttachment ? [asAttachment] : [],
        mentions: mentions().map(mentionToSimpleMention),
        navigate: { navigate: true },
      });
    } else if (destination_.type === 'channel') {
      sendToChannel({
        channelId: destination_.id,
        content: markdownState(),
        attachments: asAttachment ? [asAttachment] : [],
        mentions: mentions().map(mentionToSimpleMention),
        navigate: { navigate: true },
      });
    }

    if (props.isOpenSignal) {
      props.isOpenSignal[1](false);
    }
  }

  const [warningGiven, setWarningGiven] = createSignal(false);

  const handleInteractOutside = (e: PointerDownOutsideEvent) => {
    e.preventDefault();
    const trimmed = markdownState().trim();
    if (trimmed.length > 0 && warningGiven() === false) {
      toast.alert(
        'Are you sure you want to leave? Your message will be deleted.'
      );
      setWarningGiven(true);
    } else {
      if (props.isOpenSignal) {
        props.isOpenSignal[1](false);
      }
    }
  };

  return (
    <Dialog
      modal
      open={props.isOpenSignal ? props.isOpenSignal[0]() : undefined}
      onOpenChange={props.isOpenSignal ? props.isOpenSignal[1] : undefined}
    >
      <Show when={props.trigger}>
        {(triggerComponent) => {
          return <Dialog.Trigger>{triggerComponent()}</Dialog.Trigger>;
        }}
      </Show>
      <Dialog.Portal>
        <Dialog.Overlay
          class="fixed flex inset-0 z-modal bg-modal-overlay items-center justify-center text-ink transition-[max-height] duration-350 ease-out sm:transition-none portal-scope"
          style={{
            'max-height': 'calc(100% - var(--keyboard-height))',
          }}
        >
          <Dialog.Content
            class="w-[512px] bg-dialog rounded-lg border-edge border-1 shadow-lg"
            onPointerDownOutside={(e) => {
              handleInteractOutside(e);
            }}
          >
            <div class="flex flex-row justify-between items-center p-4">
              <Dialog.Title class="font-medium text-2xl text-ink-muted">
                {props.title}
              </Dialog.Title>
              <Dialog.CloseButton class="text-ink-muted hover:bg-hover hover-transition-bg rounded-md p-1">
                <XIcon class="w-5 h-5" />
              </Dialog.CloseButton>
            </div>
            <div class="flex flex-col p-2 gap-2">
              <RecipientSelector<'user' | 'contact' | 'channel'>
                options={destinationOptions}
                selectedOptions={selectedOptions}
                setSelectedOptions={setSelectedOptions}
                placeholder="Add by email or channel"
                triedToSubmit={triedToSubmit}
                triggerMode="input"
              />
              <div class="flex flex-col w-full h-[200px] rounded-md border border-edge">
                <FormatRibbon
                  state={markdownFormatState}
                  inlineFormat={setInlineFormat}
                  nodeFormat={setNodeFormat}
                />
                <div
                  class="w-full h-full p-2 overflow-auto portal-scope"
                  onClick={() => focusMarkdownArea()}
                >
                  <MarkdownArea
                    placeholder="Write a message..."
                    initialValue={markdownState()}
                    onEnter={(e: KeyboardEvent) => {
                      e.preventDefault();
                      return true;
                    }}
                    onEscape={(e: KeyboardEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      return true;
                    }}
                    portalScope="local"
                  />
                </div>
              </div>
            </div>
            <div class="w-full flex flex-row justify-between items-center p-2">
              <Show when={props.source === 'block'} fallback={<div />}>
                <CopyLinkButton />
              </Show>
              <div class="flex flex-row gap-2 items-center">
                <TextButton
                  disabled={markdownState().trim().length === 0}
                  text="Send"
                  theme="accent"
                  onClick={handleSubmit}
                />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}

export function useNewMessageModal(
  props: Pick<NewMessageProps, 'title' | 'source'>
) {
  const isOpenSignal = createSignal(false);
  return {
    Modal: () => {
      return (
        <Show when={isOpenSignal[0]()}>
          <NewMessage
            source={props.source}
            title={props.title}
            isOpenSignal={isOpenSignal}
          />
        </Show>
      );
    },
    open: () => isOpenSignal[1](true),
    close: () => isOpenSignal[1](false),
  };
}

export function ForwardButton() {
  return (
    <NewMessage
      source="block"
      trigger={
        <TextButton
          icon={PaperPlaneIcon}
          theme={'base'}
          text={undefined}
          children={undefined}
        />
      }
      title="Forward Message"
    />
  );
}
