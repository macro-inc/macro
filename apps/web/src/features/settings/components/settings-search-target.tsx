import { createEffect, type JSX, onCleanup } from 'solid-js';
import type { SettingsSearchResult } from '../core/settings-search';

/** Waits for a routed/lazy settings page, then reveals its matching control. */
export function SettingsSearchTarget(props: {
  result?: SettingsSearchResult;
  children: JSX.Element;
}) {
  let root!: HTMLDivElement;
  createEffect(() => {
    const result = props.result;
    if (!result) return;
    let highlighted: HTMLElement | undefined;
    const reveal = () => {
      const candidates = root.querySelectorAll<HTMLElement>(
        '[data-settings-target]'
      );
      const target = result.target
        ? [...candidates].find(
            (el) => el.dataset.settingsTarget === result.target
          )
        : root.querySelector<HTMLElement>('[data-settings-page] h1');
      if (!target) return false;
      target.tabIndex = -1;
      const page = target.closest<HTMLElement>('[data-settings-page]');
      if (page)
        page.scrollTo({
          top:
            page.scrollTop +
            target.getBoundingClientRect().top -
            page.getBoundingClientRect().top -
            16,
          behavior: 'instant',
        });
      target.focus({ preventScroll: true });
      target.classList.add('ring-2', 'ring-accent', 'ring-offset-2');
      highlighted = target;
      return true;
    };
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    if (!reveal()) observer.observe(root, { childList: true, subtree: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      highlighted?.classList.remove('ring-2', 'ring-accent', 'ring-offset-2');
    }, 4000);
    onCleanup(() => {
      clearTimeout(timeout);
      observer.disconnect();
      highlighted?.classList.remove('ring-2', 'ring-accent', 'ring-offset-2');
    });
  });
  return (
    <div ref={root} class="relative h-full min-h-0">
      {props.children}
    </div>
  );
}
