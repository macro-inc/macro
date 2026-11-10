import { t } from '@app/lib/i18n';
import Upload from '@icon/system/regular/upload-simple.svg';
import { confirmDialog, Dropdown, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BackgroundEffect } from '../../media/background-effect';
import {
  createRecentBackgrounds,
  recent,
} from '../../media/recent-background-state';

export { rememberRecentBackgroundImage } from '../../media/recent-background-state';

export function RecentBackgroundImages(props: {
  effect: BackgroundEffect;
  disabled?: boolean;
  uploading?: boolean;
  onSelect: (effect: BackgroundEffect) => boolean | Promise<boolean>;
  onUploadClick: () => void;
  phone?: boolean;
  embedded?: boolean;
}) {
  const { current, removing, remove, select } = createRecentBackgrounds({
    effect: () => props.effect,
    disabled: () => props.disabled,
    onSelect: (effect) => props.onSelect(effect),
    confirmRemoval: () =>
      confirmDialog(() => ({
        title: t('calls.removeBackground'),
        body: t('calls.removeBackgroundBody'),
        confirmLabel: t('calls.removeBackgroundAction'),
        tone: 'danger',
      })),
  });
  return (
    <div
      class={
        props.embedded
          ? 'contents'
          : props.phone
            ? 'space-y-2'
            : 'space-y-2 pt-2'
      }
    >
      <Show when={!props.embedded}>
        <span class="text-xs text-ink-muted">Recent</span>
      </Show>
      <Dynamic
        component={props.phone ? 'div' : Dropdown.RadioGroup}
        class={props.embedded ? 'contents' : 'grid grid-cols-3 gap-2'}
        value={props.effect.type === 'image' ? props.effect.path : ''}
        onChange={(path: unknown) => {
          if (typeof path !== 'string') return;
          const image = recent().find((image) => image.path === path);
          if (image) select(image);
        }}
      >
        <For each={recent()}>
          {(image, index) => (
            <div class="group relative min-w-0">
              <Tooltip label={`Recent image ${index() + 1}`} class="block">
                <Dynamic
                  component={props.phone ? 'button' : Dropdown.RadioItem}
                  value={image.path}
                  type="button"
                  closeOnSelect={false}
                  role={props.phone ? 'radio' : 'menuitemradio'}
                  aria-label={`Recent image ${index() + 1}`}
                  aria-checked={current(image)}
                  disabled={props.disabled}
                  class="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-edge-muted p-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] data-highlighted:after:overlay-hover data-highlighted:bg-transparent focus-visible:outline-2 focus-visible:outline-accent"
                  classList={{ 'ring-2 ring-accent': current(image) }}
                  onClick={props.phone ? () => select(image) : undefined}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== 'Delete' && event.key !== 'Backspace')
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    remove(image);
                  }}
                >
                  <img src={image.path} alt="" class="size-full object-cover" />
                </Dynamic>
              </Tooltip>
              <button
                type="button"
                aria-label="Remove from recent"
                disabled={props.disabled || removing()}
                class="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-surface/80 text-ink opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(image);
                }}
              >
                ×
              </button>
            </div>
          )}
        </For>
        <Tooltip label="Upload background image" class="block">
          <Dynamic
            component={props.phone ? 'button' : Dropdown.Item}
            type="button"
            aria-label="Upload background image"
            disabled={props.disabled || props.uploading}
            class="flex w-full aspect-[4/3] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-edge-muted text-xs text-ink-muted"
            onClick={props.phone ? props.onUploadClick : undefined}
            onSelect={props.phone ? undefined : props.onUploadClick}
          >
            <Upload class="size-4" />
            <Show when={!props.embedded}>
              {props.uploading ? 'Loading…' : 'Upload'}
            </Show>
          </Dynamic>
        </Tooltip>
      </Dynamic>
    </div>
  );
}
