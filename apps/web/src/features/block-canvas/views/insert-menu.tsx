import ImageIcon from '@icon/system/regular/image.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { Popover } from '@kobalte/core/popover';
import { Dropdown } from '@ui';
import { createSignal, ErrorBoundary, Show, Suspense } from 'solid-js';
import { CanvasInsertRadialMenu } from '../components/insert-radial-menu';
import type { CanvasAsset } from '../core/assets';
import type { CanvasInsertMode } from '../core/insert';
import type { CanvasInsertLocation } from '../primitives/create-insert-state';
import { CanvasAssetPicker } from './asset-picker';

export function CanvasInsertMenu(props: {
  location: CanvasInsertLocation;
  onSelect: (asset: CanvasAsset, mode: CanvasInsertMode) => void;
  onFiles: (files: File[]) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  let uploadInput: HTMLInputElement | undefined;
  const [mode, setMode] = createSignal<CanvasInsertMode>();
  const anchor = () => ({ ...props.location.screen, width: 0, height: 0 });
  return (
    <>
      <input
        ref={uploadInput}
        type="file"
        class="hidden"
        multiple
        accept="image/*,video/*,.heic,.heif"
        aria-label="Upload media"
        onCancel={props.onClose}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length) props.onFiles(files);
          else props.onClose();
        }}
      />
      <Show
        when={mode()}
        keyed
        fallback={
          <Show
            when={props.location.presentation === 'dropdown'}
            fallback={
              <Popover
                open
                placement="bottom-start"
                getAnchorRect={() => ({
                  x: 0,
                  y: 0,
                  width: 0,
                  height: 0,
                })}
                gutter={0}
                flip={false}
                overflowPadding={0}
                onOpenChange={(open) => {
                  if (!open) props.onClose();
                }}
              >
                <Popover.Portal>
                  <Popover.Content
                    class="z-action-menu outline-none"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      if (!mode()) props.onRestoreFocus();
                    }}
                  >
                    <Popover.Title class="sr-only">Insert</Popover.Title>
                    <CanvasInsertRadialMenu
                      center={props.location.screen}
                      onMedia={() => setMode('media')}
                      onReference={() => setMode('reference')}
                      onUpload={() => uploadInput?.click()}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
            }
          >
            <Dropdown
              open
              placement="top"
              getAnchorRect={anchor}
              onOpenChange={(open) => {
                if (!open && !mode()) props.onClose();
              }}
            >
              <Dropdown.Content
                class="w-48"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (!mode()) props.onRestoreFocus();
                }}
              >
                <Dropdown.Group>
                  <Dropdown.Item onSelect={() => setMode('media')}>
                    <ImageIcon class="size-4" /> Media
                  </Dropdown.Item>
                  <Dropdown.Item
                    closeOnSelect={false}
                    onSelect={() => uploadInput?.click()}
                  >
                    <UploadIcon class="size-4" /> Upload media
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => setMode('reference')}>
                    <LinkIcon class="size-4" /> Reference
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        }
      >
        {(type) => (
          <Popover
            open
            placement={
              props.location.presentation === 'dropdown'
                ? 'top'
                : 'bottom-start'
            }
            getAnchorRect={anchor}
            gutter={4}
            fitViewport
            overflowPadding={8}
            onOpenChange={(open) => {
              if (!open) props.onClose();
            }}
          >
            <Popover.Portal>
              <Popover.Content
                class="menu-surface z-action-menu flex w-80 max-w-[calc(100vw-1rem)] min-h-0 flex-col rounded-xl text-sm outline-none"
                style={{
                  height: type === 'media' ? '28rem' : '21rem',
                  'max-height':
                    'min(28rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)))',
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (mode()) props.onRestoreFocus();
                }}
              >
                <Popover.Title class="sr-only">Insert {type}</Popover.Title>
                <ErrorBoundary
                  fallback={(_, reset) => (
                    <button
                      type="button"
                      class="p-3 text-ink-muted"
                      onClick={reset}
                    >
                      Could not load files. Try again
                    </button>
                  )}
                >
                  <Suspense
                    fallback={
                      <p role="status" class="p-3 text-ink-muted">
                        Loading files…
                      </p>
                    }
                  >
                    <CanvasAssetPicker
                      mode={type}
                      onSelect={(asset) => props.onSelect(asset, type)}
                      onFiles={props.onFiles}
                      onClose={props.onClose}
                    />
                  </Suspense>
                </ErrorBoundary>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        )}
      </Show>
    </>
  );
}
