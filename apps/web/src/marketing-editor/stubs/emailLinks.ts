/**
 * Stub for @core/context/emailLinks, swapped in by the demo's Vite config.
 *
 * The real module owns email-link identity metadata (which macro ids are extra
 * mailboxes the signed-in user attached to their own account) and builds it
 * from useEmailLinksQuery against an authenticated session. It is reached here
 * through UserIcon, which asks isConnectedSecondaryInbox() to decide whether an
 * avatar is a person or a connected mailbox.
 *
 * That made it the @ menu's last hidden dependency, and the reason @ appeared
 * to do nothing at all: the context is only touched once the menu renders a
 * person row, so the assertion threw inside the menu's own render rather than
 * at load. The trigger fired, the search node went in, openMenu() ran, and then
 * the menu tore its own render down on the way up.
 *
 * The demo's visitor is signed out and has no mailboxes, so every id is a
 * person and the link list is empty.
 */
import type { JSX } from 'solid-js';

const NO_LINKS: never[] = [];

/** Passes children straight through; the value below needs no setup. */
export function EmailLinksContextProvider(props: { children: JSX.Element }) {
  return props.children;
}

export function useEmailLinksContext() {
  return {
    links: () => NO_LINKS,
    isConnectedSecondaryInbox: () => false,
  };
}
