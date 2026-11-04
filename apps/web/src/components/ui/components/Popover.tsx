import {
  Popover as KobaltePopover,
  type PopoverContentProps as KobaltePopoverContentProps,
  type PopoverPortalProps as KobaltePopoverPortalProps,
  type PopoverRootProps as KobaltePopoverRootProps,
} from '@kobalte/core/popover';
import { createSignal, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface, type SurfaceProps } from './Surface';

export type PopoverRootProps = KobaltePopoverRootProps;
export type PopoverContentProps = KobaltePopoverContentProps & {
  class?: string;
  children?: JSX.Element;
  depth?: SurfaceProps['depth'];
  mount?: KobaltePopoverPortalProps['mount'];
  portalScope?: 'local';
};

function PopoverRoot(props: PopoverRootProps) {
  return (
    <KobaltePopover
      modal={false}
      placement="bottom-end"
      gutter={4}
      {...props}
    />
  );
}

function PopoverContent(props: PopoverContentProps) {
  const [searchRef, setSearchRef] = createSignal<HTMLDivElement>();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'depth',
    'mount',
    'portalScope',
  ]);
  const mount = () =>
    local.mount ??
    (local.portalScope === 'local'
      ? (searchRef()?.closest<HTMLElement>('.portal-scope') ?? undefined)
      : undefined);

  return (
    <>
      <div class="hidden" ref={setSearchRef} />
      <KobaltePopover.Portal mount={mount()}>
        <KobaltePopover.Content
          as={Surface}
          depth={local.depth ?? 2}
          hideBorder
          class={cn(
            'menu-surface z-action-menu size-auto rounded-xl p-3 text-sm text-ink outline-none menu-open-animation',
            local.class
          )}
          {...rest}
        >
          {local.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </>
  );
}

/** Click-open form overlay. Content owns its portal and surface.
 *
 * @do Name the overlay with Popover.Title and compose controls inside Content.
 * @do Use portalScope="local" when the overlay belongs to a local portal scope.
 * @dont Wrap Content in another Portal or use a dropdown menu for form controls.
 */
export const Popover = Object.assign(PopoverRoot, {
  Root: PopoverRoot,
  Trigger: KobaltePopover.Trigger,
  Content: PopoverContent,
  Title: KobaltePopover.Title,
  Description: KobaltePopover.Description,
  Close: KobaltePopover.CloseButton,
});
