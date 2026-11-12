import type { BackgroundEffect } from '@core/media/background-effect';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Image from '@icon/system/regular/image.svg';
import { Dropdown } from '@ui';
import { createUniqueId, For, type JSX, Show } from 'solid-js';
import { RecentBackgroundImages } from './recent-background-images';

export function BackgroundPreview(props: { blur?: number }) {
  const filter = createUniqueId();
  return (
    <svg
      viewBox="0 0 120 90"
      aria-hidden="true"
      class="aspect-[4/3] w-full rounded-lg overflow-hidden ring-1 ring-edge-muted group-data-checked:ring-2 group-data-checked:ring-accent"
    >
      <defs>
        <filter id={filter}>
          <feGaussianBlur stdDeviation={props.blur ?? 0} />
        </filter>
      </defs>
      <rect width="120" height="90" fill="#494e56" />
      <g filter={`url(#${filter})`}>
        <rect x="8" y="7" width="38" height="39" rx="2" fill="#a6b5c5" />
        <path d="M27 7v39" stroke="#494e56" stroke-width="4" />
        <rect x="77" y="20" width="37" height="5" rx="1" fill="#2d333a" />
        <rect x="83" y="5" width="8" height="15" rx="1" fill="#b59673" />
        <rect x="94" y="9" width="7" height="11" rx="1" fill="#8197b4" />
        <rect x="91" y="67" width="13" height="19" rx="2" fill="#777c76" />
        <circle cx="97" cy="63" r="12" fill="#788f77" />
        <path d="M0 76h120v14H0z" fill="#393d43" />
      </g>
      <circle cx="60" cy="43" r="12" fill="#c5cbd2" />
      <path d="M39 90V78a21 21 0 0 1 42 0v12z" fill="#c5cbd2" />
    </svg>
  );
}

export function MediaBackgroundPicker(props: {
  effect: BackgroundEffect;
  trigger?: JSX.Element;
  placement?: 'top-start' | 'bottom-start' | 'top-end' | 'bottom-end';
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  uploading?: boolean;
  onSelect: (effect: BackgroundEffect) => void;
  onUpload?: (file: File) => void;
}) {
  let input: HTMLInputElement | undefined;
  const selected = () =>
    props.effect.type === 'blur'
      ? props.effect.intensity === 'light'
        ? 'light'
        : 'heavy'
      : props.effect.type;
  const select = (value: string) => {
    if (value === 'none') props.onSelect({ type: 'none' });
    else if (value === 'light' || value === 'heavy')
      props.onSelect({ type: 'blur', intensity: value });
  };
  return (
    <>
      <Dropdown
        placement={props.placement ?? 'bottom-end'}
        onOpenChange={props.onOpenChange}
      >
        <Show
          keyed
          when={props.trigger}
          fallback={
            <Dropdown.Trigger
              disabled={props.disabled || props.uploading}
              size="lg"
              fullWidth
              class="min-w-0 text-sm"
            >
              <Image class="size-4 shrink-0" />
              <span class="flex-1 text-left">Backgrounds</span>
              <CaretDown class="size-3 shrink-0" />
            </Dropdown.Trigger>
          }
        >
          {(trigger) => trigger}
        </Show>
        <Dropdown.Content class="min-w-72">
          <Dropdown.RadioGroup
            class="grid grid-cols-3 gap-2"
            value={selected()}
            onChange={select}
          >
            <For
              each={[
                { value: 'none', label: 'None', caption: 'None', blur: 0 },
                {
                  value: 'light',
                  label: 'Light blur',
                  caption: 'Light',
                  blur: 2,
                },
                {
                  value: 'heavy',
                  label: 'Strong blur',
                  caption: 'Strong',
                  blur: 5,
                },
              ]}
            >
              {(option) => (
                <Dropdown.RadioItem
                  class="group flex-col gap-1 p-0 text-center text-xs"
                  value={option.value}
                  aria-label={option.label}
                  closeOnSelect
                  disabled={props.disabled || props.uploading}
                >
                  <BackgroundPreview blur={option.blur} />
                  <span>{option.caption}</span>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
          <Show when={props.onUpload}>
            <Dropdown.Separator />
            <RecentBackgroundImages
              effect={props.effect}
              disabled={props.disabled || props.uploading}
              uploading={props.uploading}
              onSelect={(effect) => {
                props.onSelect(effect);
                return true;
              }}
              onUploadClick={() => input?.click()}
            />
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <Show when={props.onUpload}>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Upload background image"
          class="sr-only"
          tabindex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) props.onUpload?.(file);
          }}
        />
      </Show>
    </>
  );
}
