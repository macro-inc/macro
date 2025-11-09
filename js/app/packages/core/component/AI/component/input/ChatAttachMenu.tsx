import { withAnalytics } from '@coparse/analytics';
import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import type { Item } from '@service-storage/generated/schemas/item';

const { track, TrackingEvents } = withAnalytics();

import {
  useChatAttachableHistory,
  useGetChatAttachmentInfo,
} from '@core/component/AI/signal/attachment';
import type { Attachment, UploadQueue } from '@core/component/AI/types';
import { EntityIcon } from '@core/component/EntityIcon';
import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import clickOutside from '@core/directive/clickOutside';
import { fileSelector } from '@core/directive/fileSelector';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getItemBlockName } from '@core/util/getItemBlockName';
import {
  autoUpdate,
  computePosition,
  flip,
  limitShift,
  offset,
  shift,
} from '@floating-ui/dom';
import DeviceMobileIcon from '@icon/regular/device-mobile-speaker.svg';
import LaptopIcon from '@icon/regular/laptop.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import fuzzy from 'fuzzy';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';

// NOTE: solid directives
false && fileSelector;
false && clickOutside;

type ChatAttachMenuProps = {
  open: boolean;
  close: () => void;
  anchorRef: HTMLDivElement;
  containerRef: HTMLElement;
  onAttach: (attachment: Attachment) => void;
  uploadQueue: UploadQueue;
};

function truncate(str: string, maxLength: number = 30) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// TODO: create a shared component for chat attach menu and block channel AttachMenu
// TODO: add other supported attachment types, e.g. chat/channel
export function ChatAttachMenu(props: ChatAttachMenuProps) {
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [popupRef, setPopupRef] = createSignal<HTMLDivElement>();
  const history = useChatAttachableHistory();
  const { getDocumentAttachment } = useGetChatAttachmentInfo();

  const [input, setInput] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [vlistRef, setVlistRef] = createSignal<VirtualizerHandle>();
  const [isKeyboardMode, setIsKeyboardMode] = createSignal(false);

  const updatePosition = async () => {
    const popupRef_ = popupRef();
    if (!popupRef_) return;
    const { x, y } = await computePosition(props.anchorRef, popupRef_, {
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({
          fallbackStrategy: 'bestFit',
          boundary: props.containerRef,
        }),
        shift({
          padding: 8,
          boundary: props.containerRef,
          limiter: limitShift(),
        }),
      ],
    });
    setPosition({ x, y });
  };

  const rankedHistory = createMemo(() => {
    const searchQuery = input().toLowerCase();
    if (!searchQuery) return history();
    return fuzzy
      .filter(searchQuery, history(), {
        extract: (item) => item.name,
      })
      .map((item) => item.original);
  });

  // Reset selected index when results change
  createEffect(() => {
    rankedHistory();
    setSelectedIndex(0);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = rankedHistory();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (items.length === 0) return;
        setIsKeyboardMode(true);
        const currentIndex = selectedIndex();
        const nextIndex = (currentIndex + 1) % items.length;
        setSelectedIndex(nextIndex);
        // Scroll to the new index
        const vlist = vlistRef();
        if (vlist && vlist.scrollToIndex) {
          vlist.scrollToIndex(nextIndex, { align: 'nearest' });
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (items.length === 0) return;
        setIsKeyboardMode(true);
        const currentUpIndex = selectedIndex();
        if (currentUpIndex === 0) {
          // Go back to search input when at first item
          searchInputRef()?.focus();
        } else {
          const prevIndex = currentUpIndex - 1;
          setSelectedIndex(prevIndex);
          // Scroll to the new index
          const vlist = vlistRef();
          if (vlist && vlist.scrollToIndex) {
            vlist.scrollToIndex(prevIndex, { align: 'nearest' });
          }
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (items.length === 0) return;
        const selectedItem = items[selectedIndex()];
        if (selectedItem) {
          selectItem(selectedItem);
        }
        break;
      case 'Escape':
        e.preventDefault();
        props.close();
        break;
      case 'Backspace':
        e.preventDefault();
        const currentInput = input();
        if (currentInput.length > 0) {
          const newInput = currentInput.slice(0, -1);
          setInput(newInput);
          // Focus the search input to continue typing naturally
          const inputRef = searchInputRef();
          if (inputRef) {
            inputRef.focus();
            // Set cursor to end of input
            inputRef.setSelectionRange(newInput.length, newInput.length);
          }
        }
        break;
      default:
        // Handle regular typing - add to search input
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const currentInput = input();
          const newInput = currentInput + e.key;
          setInput(newInput);
          // Focus the search input to continue typing naturally
          const inputRef = searchInputRef();
          if (inputRef) {
            inputRef.focus();
            // Set cursor to end of input
            inputRef.setSelectionRange(newInput.length, newInput.length);
          }
        }
        break;
    }
  };

  const handleMouseMove = () => {
    if (isKeyboardMode()) {
      setIsKeyboardMode(false);
    }
  };

  const selectItem = (item: Item) => {
    // TODO: add other supported attachment types, e.g. channel
    if (item.type !== 'document') {
      console.error('ChatAttachMenu only supports document items');
      return;
    }

    // TODO: add overrides to getDocumentAttachment if we already have the data
    // const attachment = getDocumentAttachment({
    //   itemType: 'document',
    //   itemId: item.id,
    //   fileType: item.fileType ?? undefined,
    //   documentName: item.name,
    // });
    const attachment = getDocumentAttachment(item.id);

    if (attachment) {
      props.onAttach(attachment);
    }

    props.close();
  };

  const [searchInputRef, setSearchInputRef] = createSignal<HTMLInputElement>();

  createEffect(() => {
    const popupRef_ = popupRef();
    if (!popupRef_) return;

    track(TrackingEvents.CHAT.ATTACHMENT.MENU.OPEN);

    document.body.style.overflow = 'hidden';
    const cleanup = autoUpdate(props.anchorRef, popupRef_, updatePosition);

    // Focus the search input for immediate typing
    setTimeout(() => {
      searchInputRef()?.focus();
    }, 0);

    onCleanup(() => {
      track(TrackingEvents.CHAT.ATTACHMENT.MENU.CLOSE);
      cleanup();
      document.body.style.overflow = '';
    });
  });

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.close();
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 bg-transparent z-[99]"
        onClick={handleOverlayClick}
        onMouseDown={handleOverlayClick}
      >
        <div
          class="absolute z-[100]"
          ref={setPopupRef}
          use:clickOutside={props.close}
          onKeyDown={handleKeyDown}
          onMouseMove={handleMouseMove}
          tabIndex={0}
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`,
            'transform-origin': 'top',
          }}
        >
          <OldMenu>
            <div class="flex flex-row items-center w-full p-2 gap-2 text-sm border-b border-edge text-ink">
              <SearchIcon class="w-3 h-3" />
              <input
                ref={setSearchInputRef}
                value={input()}
                onInput={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Handle arrow keys to navigate to the list
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const items = rankedHistory();
                    if (items.length > 0) {
                      setIsKeyboardMode(true);
                      setSelectedIndex(0);
                      const vlist = vlistRef();
                      if (vlist && vlist.scrollToIndex) {
                        vlist.scrollToIndex(0, { align: 'nearest' });
                      }
                      // Transfer focus to the container for further navigation
                      popupRef()?.focus();
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    props.close();
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const items = rankedHistory();
                    const selectedItem = items[selectedIndex()];
                    if (selectedItem) {
                      track(TrackingEvents.CHAT.ATTACHMENT.MENU.SELECT);
                      selectItem(selectedItem);
                    }
                  }
                }}
                class="w-full outline-none"
                placeholder="Search Attachments"
              />
            </div>
            <div class="flex flex-col gap-1 max-h-[250px] w-[300px] overflow-y-auto">
              <Show
                when={rankedHistory().length > 0}
                fallback={
                  <div class="p-2 w-full flex-col justify-center items-center">
                    <p class="text-sm text-ink-muted">No results</p>
                  </div>
                }
              >
                <VList
                  ref={setVlistRef}
                  data={rankedHistory()}
                  overscan={10}
                  itemSize={40}
                  style={{ height: '100%', contain: 'content' }}
                >
                  {(item, index) => (
                    <div
                      class={index() === selectedIndex() ? 'bg-hover' : ''}
                      onMouseEnter={() => {
                        if (!isKeyboardMode()) {
                          setSelectedIndex(index());
                        }
                      }}
                    >
                      <OldMenuItem
                        text={truncate(item.name)}
                        icon={() => (
                          <EntityIcon
                            targetType={getItemBlockName(item, true)}
                            size="xs"
                          />
                        )}
                        onClick={() => selectItem(item)}
                      />
                    </div>
                  )}
                </VList>
              </Show>
            </div>
            <div
              class="w-full"
              use:fileSelector={{
                acceptedFileExtensions: SUPPORTED_ATTACHMENT_EXTENSIONS,
                multiple: true,
                onSelect: (files) => {
                  props.uploadQueue.upload(files);
                  props.close();
                },
              }}
            >
              <OldMenuItem
                text={
                  isTouchDevice
                    ? 'Upload from your device'
                    : 'Upload from your computer'
                }
                icon={isTouchDevice ? DeviceMobileIcon : LaptopIcon}
                spacerTop
              />
            </div>
          </OldMenu>
        </div>
      </div>
    </Show>
  );
}
