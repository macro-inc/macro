import { Popover } from '@kobalte/core/popover';
import { createSignal, type JSX } from 'solid-js';

/** Keep nested menus inside their dialog or date/time popover's focus boundary. */
export function EventComposerPopoverPortal(props: { children: JSX.Element }) {
  const [searchRef, setSearchRef] = createSignal<HTMLDivElement>();
  const mount = () =>
    searchRef()?.closest<HTMLElement>('.portal-scope') ?? undefined;

  return (
    <>
      <div class="hidden" ref={setSearchRef} />
      <Popover.Portal mount={mount()}>{props.children}</Popover.Portal>
    </>
  );
}
