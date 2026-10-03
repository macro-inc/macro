import type { BackgroundEffect } from '@core/media/background-effect';
import CaretDown from '@phosphor/caret-down.svg';
import Image from '@phosphor/image.svg';
import Prohibit from '@phosphor/prohibit.svg';
import Upload from '@phosphor/upload-simple.svg';
import { Dropdown, SingleSelectCheck } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export function BlurIcon(props: { strong?: boolean }) {
  const count = () => (props.strong ? 5 : 3);
  const dots = () =>
    Array.from({ length: count() ** 2 }, (_, index) => ({
      x: 4 + (index % count()) * (16 / (count() - 1)),
      y: 4 + Math.floor(index / count()) * (16 / (count() - 1)),
    }));
  return (
    <svg
      viewBox="0 0 24 24"
      class="size-4 shrink-0"
      fill="currentColor"
      aria-hidden="true"
    >
      <For each={dots()}>
        {(dot) => <circle cx={dot.x} cy={dot.y} r="1.2" />}
      </For>
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
        <Dropdown.Content class="min-w-48">
          <Dropdown.RadioGroup value={selected()} onChange={select}>
            <Dropdown.RadioItem
              value="none"
              closeOnSelect
              disabled={props.disabled || props.uploading}
            >
              <Prohibit class="size-4" />
              <span class="flex-1">None</span>
              <SingleSelectCheck active={selected() === 'none'} />
            </Dropdown.RadioItem>
            <Dropdown.RadioItem
              value="light"
              closeOnSelect
              disabled={props.disabled || props.uploading}
            >
              <BlurIcon />
              <span class="flex-1">Light blur</span>
              <SingleSelectCheck active={selected() === 'light'} />
            </Dropdown.RadioItem>
            <Dropdown.RadioItem
              value="heavy"
              closeOnSelect
              disabled={props.disabled || props.uploading}
            >
              <BlurIcon strong />
              <span class="flex-1">Strong blur</span>
              <SingleSelectCheck active={selected() === 'heavy'} />
            </Dropdown.RadioItem>
            <Show when={props.effect.type === 'image'}>
              <Dropdown.RadioItem
                value="image"
                closeOnSelect
                disabled={props.disabled || props.uploading}
              >
                <Image class="size-4" />
                <span class="flex-1">Custom background</span>
                <SingleSelectCheck active />
              </Dropdown.RadioItem>
            </Show>
          </Dropdown.RadioGroup>
          <Show when={props.onUpload}>
            <Dropdown.Separator />
            <Dropdown.Item
              disabled={props.disabled || props.uploading}
              onSelect={() => input?.click()}
            >
              <Upload class="size-4" />
              <span>
                {props.uploading ? 'Loading image…' : 'Upload an image'}
              </span>
            </Dropdown.Item>
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
