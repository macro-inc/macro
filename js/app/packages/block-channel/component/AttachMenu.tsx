import { handleFileUpload } from '@block-channel/utils/inputAttachments';
import { EntityIcon } from '@core/component/EntityIcon';
import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import { blockAcceptedFileExtensions } from '@core/constant/allBlocks';
import clickOutside from '@core/directive/clickOutside';
import { fileSelector } from '@core/directive/fileSelector';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import { fuzzyFilter } from '@core/util/fuzzyName';
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
import { useHistory } from '@service-storage/history';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { VList } from 'virtua/solid';

// NOTE: solid directives
false && fileSelector;
false && clickOutside;

type AttachMenuProps = {
  open: boolean;
  close: () => void;
  anchorRef: HTMLDivElement;
  containerRef: HTMLElement;
  onAttach: (attachment: InputAttachment) => void;
  inputAttachmentsStore: {
    store: Record<string, InputAttachment[]>;
    setStore: SetStoreFunction<Record<string, InputAttachment[]>>;
    key: string;
  };
};

function truncate(str: string, maxLength: number = 30) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

export function AttachMenu(props: AttachMenuProps) {
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [popupRef, setPopupRef] = createSignal<HTMLDivElement>();
  const history = useHistory();
  const inputAttachments = () =>
    props.inputAttachmentsStore.store[props.inputAttachmentsStore.key] ?? [];

  const [input, setInput] = createSignal('');

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

  const baseHistory = createMemo(() => {
    return [...history()].filter(
      (item) => !inputAttachments().find((a) => a.id === item.id)
    );
  });

  const rankedHistory = createMemo(() => {
    const searchQuery = input();
    return fuzzyFilter(searchQuery, baseHistory(), (item) => item.name);
  });

  createEffect(() => {
    const popupRef_ = popupRef();
    if (!popupRef_) return;

    document.body.style.overflow = 'hidden';
    const cleanup = autoUpdate(props.anchorRef, popupRef_, updatePosition);

    onCleanup(() => {
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
        class="fixed inset-0 bg-transparent z-item-options-menu"
        onClick={handleOverlayClick}
        onMouseDown={handleOverlayClick}
      >
        <div
          class="absolute z-item-options-menu"
          ref={setPopupRef}
          use:clickOutside={props.close}
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`,
            'transform-origin': 'top',
          }}
        >
          <OldMenu>
            <div class="flex flex-row items-center w-full p-2 gap-2 text-sm border-b border-edge text-ink mb-1">
              <SearchIcon class="w-3 h-3" />
              <input
                value={input()}
                onInput={(e) => setInput(e.target.value)}
                class="w-full"
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
                  data={rankedHistory()}
                  overscan={10}
                  itemSize={40}
                  style={{ height: '100%', contain: 'content' }}
                >
                  {(item) => (
                    <OldMenuItem
                      text={truncate(item.name)}
                      icon={() => (
                        <EntityIcon
                          targetType={getItemBlockName(item, true)}
                          size="xs"
                        />
                      )}
                      onClick={() => {
                        const blockName = getItemBlockName(item, true);
                        if (!blockName) return;

                        props.onAttach({
                          id: item.id,
                          name: item.name,
                          blockName,
                        });
                        props.close();
                      }}
                    />
                  )}
                </VList>
              </Show>
            </div>
            <div class="w-full h-px bg-edge mt-[1px]" />
            <div
              class="w-full"
              use:fileSelector={{
                acceptedFileExtensions: blockAcceptedFileExtensions,
                multiple: true,
                onSelect: (files) => {
                  handleFileUpload(files, props.inputAttachmentsStore);
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
              />
            </div>
          </OldMenu>
        </div>
      </div>
    </Show>
  );
}
