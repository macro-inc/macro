import { getSplitPanelRef } from '@app/component/split-layout/layoutUtils';
import { isInBlock } from '@core/block';
import clickOutside from '@core/directive/clickOutside';
import { blockElementSignal } from '@core/signal/blockElement';
import { Dialog } from '@kobalte/core/dialog';
import type { EntityData } from '@macro-entity';
import type { ComponentProps } from 'solid-js';
import {
  type Accessor,
  createSignal,
  type JSX,
  type ParentComponent,
  type ParentProps,
  type Setter,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { BulkRenameEntitiesView } from './BulkRenameEntitiesView';
import { MoveToProjectView } from './MoveToProjectView';

export const BulkEditEntityModalTitle = (props: { title: string }) => {
  return <h2 class="text-lg mb-3">{props.title}</h2>;
};

export const BulkEditEntityModalActionFooter = (props: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText: string;
  isDisabled?: boolean;
}) => {
  return (
    <div class="flex justify-end mt-2 tex-sm pt-2">
      <button class="py-1 px-3 font-mono text-sm" onClick={props.onCancel}>
        Cancel
      </button>
      <button
        class={`uppercase py-1 px-3 font-mono text-sm ${
          props.isDisabled
            ? 'bg-edge/20 text-ink-placeholder cursor-not-allowed'
            : 'bg-accent text-menu'
        }`}
        onClick={props.onConfirm}
        disabled={props.isDisabled}
      >
        {props.confirmText}
      </button>
    </div>
  );
};

false && clickOutside;

const BulkEditEntityModalContent = (props: {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: 'rename' | 'moveToProject' | null;
  entities: EntityData[];
}) => {
  const handleFinish = () => {
    props.setIsOpen(false);
  };

  const handleCancel = () => {
    props.setIsOpen(false);
  };
  let entityModalContentRef!: HTMLDivElement;

  return (
    <SplitModal
      mode="split"
      open={props.isOpen}
      setOpen={props.setIsOpen}
      scrim={true}
    >
      <div
        ref={entityModalContentRef}
        class="pointer-events-auto max-w-xl mt-16 bg-menu border border-edge w-lg h-fit p-2"
      >
        <div class="w-full my-1">
          <Show when={props.view === 'rename'}>
            <BulkRenameEntitiesView
              entities={props.entities}
              onFinish={handleFinish}
              onCancel={handleCancel}
            />
          </Show>
          <Show when={props.view === 'moveToProject'}>
            {/* <MoveToProjectView */}
            {/*   entity={props.entity!} */}
            {/*   onFinish={handleFinish} */}
            {/*   onCancel={handleCancel} */}
            {/* /> */}
            <div />
          </Show>
        </div>
      </div>
    </SplitModal>
  );
};

export type BulkEditEntityModalProps = {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: 'rename' | 'moveToProject';
  entities: Accessor<EntityData[]>;
};

export const BulkEditEntityModal: ParentComponent<BulkEditEntityModalProps> = (
  props
) => {
  return (
    <Show when={props.isOpen()}>
      <BulkEditEntityModalContent
        isOpen={props.isOpen}
        setIsOpen={props.setIsOpen}
        view={props.view}
        entities={props.entities()}
      />
    </Show>
  );
};

export const createGlobalBulkEditEntityModal = () => {
  const [modalProps, setModalProps] = createSignal<
    BulkEditEntityModalProps | undefined
  >();

  const openModal = (
    props: Omit<BulkEditEntityModalProps, 'isOpen' | 'setIsOpen'>
  ) => {
    setModalProps({
      ...props,
      isOpen: () => true,
      setIsOpen: (open) => {
        setModalProps((p) => (open ? p : undefined));
      },
    });
  };

  return {
    BulkEditEntityModal,
    modalProps,
    openModal,
  };
};

function SplitModal(
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
  return (
    <Dialog open={props.open()} onOpenChange={props.setOpen} modal={true}>
      <Show when={props.trigger}>
        <Dialog.Trigger>{props.trigger}</Dialog.Trigger>
      </Show>
      <ScopedPortal scope={props.mode ?? 'global'}>
        <Dialog.Overlay
          as="div"
          class="absolute z-modal"
          classList={{
            'left-[1px] right-[1px] bottom-[1px] top-[1px]':
              props.mode === 'split',
            'inset-0': props.mode !== 'split',
            'bg-modal-overlay': props.scrim !== false,
          }}
          use:clickOutside={() => props.setOpen(false)}
          on:click={() => props.setOpen(false)}
        />
        <div
          class="absolute z-modal flex justify-around pointer-events-none"
          classList={{
            'left-[1px] right-[1px] bottom-[1px] top-0': props.mode === 'split',
            'inset-0': props.mode !== 'split',
          }}
        >
          <Dialog.Content
            class="pointer-events-none!"
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

type PortalScope = 'local' | 'block' | 'global' | 'split';

/**
 * Portal with some extra scoping logic. If passed a specific mount prop or no props at all – it is
 * just a regular solid Portal.
 * @param props.scope - The scope of the portal. If 'local' it will mount to the closest element with the
 *    '.portal-scope' class. If 'block' it will mount to the containing block element. If 'global' it will
 *    mount to the document body.
 * @returns
 */
function ScopedPortal(
  props: ComponentProps<typeof Portal> & {
    scope?: PortalScope;
    show?: boolean;
  }
) {
  let searchRef!: HTMLDivElement;

  const mountRef = () => {
    if (props.mount) return props.mount;
    if (props.scope === 'block') {
      if (isInBlock()) {
        const blockElement = blockElementSignal.get();
        if (blockElement) return blockElement;
      }
    }
    if (props.scope === 'split') {
      const panelElement = getSplitPanelRef();
      if (panelElement) return panelElement;
    }
    if (props.scope === 'local') {
      const scopedElement = searchRef.closest('.portal-scope');
      if (scopedElement) return scopedElement;
    }
    return document.body;
  };

  return (
    <Show when={props.show !== false}>
      <div class="hidden" ref={searchRef} />
      <Portal mount={mountRef()}>{props.children}</Portal>
    </Show>
  );
}
