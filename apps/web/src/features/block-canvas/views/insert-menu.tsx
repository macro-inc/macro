import { fileDrop } from '@core/directive/fileDrop';
import CodeIcon from '@icon/system/regular/code.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { Popover } from '@kobalte/core/popover';
import { Dropdown } from '@ui';
import { Button } from '@ui/components/Button';
import { createSignal, ErrorBoundary, Show, Suspense } from 'solid-js';
import { CanvasInsertRadialMenu } from '../components/insert-radial-menu';
import type { CanvasAsset } from '../core/assets';
import type { CanvasInsertMode } from '../core/insert';
import type { CanvasInsertLocation } from '../primitives/create-insert-state';
import { CanvasAssetPicker } from './shared/asset-picker';

false && fileDrop;

/** Where files dragged from the desktop land, with a button for the rest. */
function MediaDropZone(props: {
  onFiles: (files: File[]) => void;
  onUpload: () => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  return (
    <div
      aria-label="Upload canvas media"
      class="m-3 mb-1.5 flex min-h-44 shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge-muted p-4 text-center"
      classList={{ 'bg-hover': dragging() }}
      use:fileDrop={{
        multiple: true,
        onDrop: props.onFiles,
        onDragStart: setDragging,
        onDragEnd: () => setDragging(false),
      }}
    >
      <UploadIcon class="size-8 text-ink-extra-muted" />
      <div>
        <p class="text-sm text-ink">Drop files here</p>
        <p class="mt-1 text-xs text-ink-muted">
          Add images or videos to this canvas.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={props.onUpload}>
        Add files
      </Button>
    </div>
  );
}

export function CanvasInsertMenu(props: {
  location: CanvasInsertLocation;
  onSelect: (asset: CanvasAsset, mode: CanvasInsertMode) => void;
  /** Files dropped on the media picker. */
  onFiles: (files: File[]) => void;
  /** Ask the device for images or videos; the menu closes as it opens. */
  onUpload: () => void;
  onArtifact: () => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [mode, setMode] = createSignal<CanvasInsertMode>();
  const anchor = () => ({ ...props.location.screen, width: 0, height: 0 });
  return (
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
                    onArtifact={props.onArtifact}
                    onUpload={props.onUpload}
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
                <Dropdown.Item onSelect={props.onUpload}>
                  <UploadIcon class="size-4" /> Upload media
                </Dropdown.Item>
                <Dropdown.Item onSelect={() => setMode('reference')}>
                  <LinkIcon class="size-4" /> Reference
                </Dropdown.Item>
                <Dropdown.Item onSelect={props.onArtifact}>
                  <CodeIcon class="size-4" /> Artifact
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
            props.location.presentation === 'dropdown' ? 'top' : 'bottom-start'
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
                    onClose={props.onClose}
                  >
                    <Show when={type === 'media'}>
                      <MediaDropZone
                        onFiles={props.onFiles}
                        onUpload={props.onUpload}
                      />
                    </Show>
                  </CanvasAssetPicker>
                </Suspense>
              </ErrorBoundary>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      )}
    </Show>
  );
}
