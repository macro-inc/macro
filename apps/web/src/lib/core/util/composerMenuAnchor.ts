/** Align composer menus with the Add button, regardless of their trigger. */
export function composerMenuAnchorRect(trigger?: HTMLElement) {
  const anchor = trigger
    ?.closest('[data-agent-composer]')
    ?.querySelector<HTMLElement>('[data-composer-menu-anchor]');
  return (anchor ?? trigger)?.getBoundingClientRect();
}
