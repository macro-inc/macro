import { ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { Dialog } from '@kobalte/core/dialog';
import {
  type Accessor,
  type JSX,
  type ParentProps,
  type Setter,
  Show,
} from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';

false && clickOutside;

export function SplitModal(
  props: ParentProps<{
    trigger?: JSX.Element;
    open: Accessor<boolean>;
    setOpen: Setter<boolean>;
    mode?: 'split' | 'global';
    scrim?: boolean;
    onCloseAutoFocus?: (e: Event) => void;
    onOpenAutoFocus?: (e: Event) => void;
  }>
) {
  const { contentOffsetTop } = useSplitPanelOrThrow();
  return (
    <Dialog
      open={props.open()}
      onOpenChange={props.setOpen}
      modal={props.mode !== 'split'}
    >
      <Show when={props.trigger}>
        <Dialog.Trigger>{props.trigger}</Dialog.Trigger>
      </Show>
      <ScopedPortal scope={props.mode ?? 'global'}>
        <Dialog.Overlay
          as="div"
          class="absolute z-modal"
          classList={{
            'left-[1px] right-[1px] bottom-[1px]': props.mode === 'split',
            'inset-0': props.mode !== 'split',
            'bg-modal-overlay': props.scrim !== false,
          }}
          style={{
            top: `${props.mode === 'split' ? contentOffsetTop() : 0}px`,
          }}
          use:clickOutside={() => props.setOpen(false)}
          on:click={() => props.setOpen(false)}
        />
        <div
          class="absolute z-modal flex justify-around pointer-events-none"
          classList={{
            'left-[1px] right-[1px] bottom-[1px]': props.mode === 'split',
            'inset-0': props.mode !== 'split',
          }}
          style={{
            top: `${contentOffsetTop()}px`,
          }}
        >
          <Dialog.Content
            onCloseAutoFocus={props.onCloseAutoFocus}
            onOpenAutoFocus={props.onOpenAutoFocus}
          >
            {props.children}
          </Dialog.Content>
        </div>
      </ScopedPortal>
    </Dialog>
  );
}
