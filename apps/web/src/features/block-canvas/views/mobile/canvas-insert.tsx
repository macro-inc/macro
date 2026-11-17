import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import UploadSimple from '@icon/system/regular/upload-simple.svg';
import { createSignal, ErrorBoundary, Show, Suspense } from 'solid-js';
import type { CanvasAsset } from '../../core/assets';
import type { CanvasInsertMode } from '../../core/insert';
import type { CanvasInsertLocation } from '../../primitives/create-insert-state';
import { CanvasAssetPicker } from '../shared/asset-picker';
import { MobileCanvasInsertSheet } from './canvas-sheets';

/** Tall enough to browse results, short enough to show the canvas above. */
const PICKER_HEIGHT = 70;

/**
 * The searchable picker for workspace media or files to reference. Media also
 * offers the device's own library, where a desktop offers a drop area.
 */
function AssetPickerSheet(props: {
  open: boolean;
  /** The picker to show; it stays while the sheet slides away. */
  mode: CanvasInsertMode | undefined;
  onSelect: (asset: CanvasAsset, mode: CanvasInsertMode) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          targetHeight={PICKER_HEIGHT}
          aria-label={
            props.mode === 'reference' ? 'Insert reference' : 'Insert media'
          }
        >
          <MobileDrawer.Handle />
          <div class="flex min-h-0 flex-1 flex-col text-sm">
            <Show when={props.mode} keyed>
              {(mode) => (
                <ErrorBoundary
                  fallback={(_, reset) => (
                    <button
                      type="button"
                      class="min-h-11 p-3 text-left text-ink-muted"
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
                      touch
                      mode={mode}
                      onSelect={(asset) => props.onSelect(asset, mode)}
                      onClose={props.onClose}
                    >
                      <Show when={mode === 'media'}>
                        {/* Lined up with the search field and the results. */}
                        <div class="shrink-0 pt-1.5">
                          <MobileDrawer.Item
                            class="gap-2"
                            onClick={props.onUpload}
                          >
                            <UploadSimple class="size-4 shrink-0" />
                            <span class="min-w-0 flex-1 truncate">
                              Upload media
                            </span>
                          </MobileDrawer.Item>
                        </div>
                      </Show>
                    </CanvasAssetPicker>
                  </Suspense>
                </ErrorBoundary>
              )}
            </Show>
          </div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/**
 * The Attach button's choices on touch: a sheet of rows, then for Media and
 * Reference a sheet with the picker. `location` is where the insert state is
 * open; nothing shows without one.
 */
export function MobileCanvasInsertMenu(props: {
  location: CanvasInsertLocation | undefined;
  onSelect: (asset: CanvasAsset, mode: CanvasInsertMode) => void;
  onUpload: () => void;
  onArtifact: () => void;
  onClose: () => void;
}) {
  // The picker chosen for one opening of the menu. Remembering which opening
  // it was for means the next one starts at the rows again.
  const [picked, setPicked] = createSignal<{
    location: CanvasInsertLocation;
    mode: CanvasInsertMode;
  }>();
  const mode = () => {
    const choice = picked();
    return choice && choice.location === props.location
      ? choice.mode
      : undefined;
  };
  const pick = (mode: CanvasInsertMode) => {
    if (props.location) setPicked({ location: props.location, mode });
  };
  return (
    <>
      <MobileCanvasInsertSheet
        open={!!props.location && !mode()}
        onClose={props.onClose}
        onMedia={() => pick('media')}
        onUpload={props.onUpload}
        onReference={() => pick('reference')}
        onArtifact={props.onArtifact}
      />
      <AssetPickerSheet
        open={mode() !== undefined}
        mode={picked()?.mode}
        onSelect={props.onSelect}
        onUpload={props.onUpload}
        onClose={props.onClose}
      />
    </>
  );
}
