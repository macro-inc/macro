import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { isInBlock } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { fileDrop } from '@core/directive/fileDrop';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import { useDisplayName, type WithCustomUserInput } from '@core/user';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  isDraggingOverChannelSignal,
  isValidChannelDragSignal,
} from '../signal/attachment';
import { handleFileUpload } from '../utils/inputAttachments';
import { DraftChannelInput } from './ChannelInput';

false && fileDrop;

export function ChannelCompose() {
  const [channelName, setChannelName] = createSignal<string>('');

  const [isDraggedOver, setIsDraggedOver] = createSignal(false);
  const [isValidChannelDrag] = isInBlock()
    ? isValidChannelDragSignal
    : createSignal(true);
  const [isDraggingOverChannel, setIsDraggingOverChannel] = isInBlock()
    ? isDraggingOverChannelSignal
    : createSignal(false);

  const [channelInputAttachmentsStore, setChannelInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});

  const { users: destinationOptions } = useCombinedRecipients();
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);

  const selectedRecipientCount = createMemo(() => selectedRecipients().length);

  createEffect(
    on(selectedRecipientCount, (current, prev) => {
      if (prev === 1 && current === 2) {
        setChannelName('');
      } else if (prev === 1 && current === 0) {
        setChannelName('');
      }
    })
  );

  const dmUserId = createMemo(() => {
    if (selectedRecipients().length === 1) {
      return selectedRecipients()[0].data.id;
    }
    return undefined;
  });

  const dmUserName = createMemo<() => string | undefined>(() => {
    const id = dmUserId();
    if (!id) return () => undefined;
    return useDisplayName(id)[0];
  });

  const [triedToSubmit, _setTriedToSubmit] = createSignal(false);

  const previewName = createMemo(() => {
    const recipients = selectedRecipients();
    if (recipients.length === 0) {
      return 'Draft message';
    } else if (recipients.length === 1) {
      const dmName = dmUserName()();
      return dmName ? `DM with ${dmName}` : 'Draft message';
    } else {
      const names = recipients
        .slice(0, 2)
        .map((r) => {
          if (r.kind === 'user') {
            return useDisplayName(r.data.id)[0]();
          }
          return r.data.email || 'Unknown';
        })
        .filter(Boolean);

      if (recipients.length > 2) {
        return `Group chat with ${names.join(', ')}, and others`;
      } else {
        return `Group chat with ${names.join(' and ')}`;
      }
    }
  });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={channelName() || previewName()}
          iconType="channel"
          badges={[
            <SplitHeaderBadge text="draft" tooltip="This is a Draft Message" />,
          ]}
        />
      </SplitHeaderLeft>
      <SplitToolbarLeft>
        <div class="h-full items-center flex" p-1></div>
      </SplitToolbarLeft>
      <div
        class="relative flex flex-col w-full h-full panel"
        use:fileDrop={{
          onDrop: (files) => {
            const inputAttachmentsStoreObj = {
              store: channelInputAttachmentsStore,
              setStore: setChannelInputAttachmentsStore,
              key: 'draft',
            };
            handleFileUpload(files, inputAttachmentsStoreObj, () => {
              setIsDraggingOverChannel(false);
            });
          },
          onDragStart: () => {
            setIsDraggedOver(true);
          },
          onDragEnd: () => {
            setIsDraggedOver(false);
          },
        }}
      >
        <Show when={isDraggedOver() || isDraggingOverChannel()}>
          <FileDropOverlay valid={isValidChannelDrag()}>
            <Show when={!isValidChannelDrag()}>
              <div class="font-mono text-failure">
                [!] Invalid attachment file
              </div>
            </Show>
            <div class="font-mono">
              Drop any file here to add it to the conversation
            </div>
          </FileDropOverlay>
        </Show>
        <div class="pt-2 h-full grow w-full overflow-y-auto px-4">
          <div class="macro-message-width mx-auto pb-1 h-full">
            <input
              type="text"
              value={channelName()}
              disabled={selectedRecipients().length < 2}
              placeholder={previewName()}
              class="text-xl font-medium mb-6 mt-12 bg-transparent border-none outline-none w-full resize-none appearance-none focus:ring-0"
              style="box-shadow: none;"
              onInput={(e) => {
                if (selectedRecipients().length >= 2) {
                  setChannelName(e.currentTarget.value);
                }
              }}
            />
            <RecipientSelector<'user' | 'contact'>
              options={destinationOptions}
              selectedOptions={selectedRecipients}
              setSelectedOptions={setSelectedRecipients}
              placeholder="To: Macro users or email addresses"
              triedToSubmit={triedToSubmit}
              focusOnMount
            />
          </div>
        </div>
        <div class="shrink-0 w-full px-4 pb-2">
          <div class="mx-auto w-full macro-message-width">
            <DraftChannelInput
              selectedRecipients={selectedRecipients}
              channelName={channelName}
              inputAttachments={{
                store: channelInputAttachmentsStore,
                setStore: setChannelInputAttachmentsStore,
                key: 'draft',
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
