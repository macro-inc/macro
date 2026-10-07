import { getIconConfig } from '@core/component/EntityIcon';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { cn, Hotkey } from '@ui';
import { getNormalizedKeyString } from '@ui/components/Hotkey';
import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CreatableBlock } from '../types';
import { createMenuDetails } from './catalog';
import type { VariantLauncherController } from './use-variant-launcher';

/** Text color class for an entry's brand color. */
export const createMenuAccent = (item: CreatableBlock) =>
  getIconConfig(item.blockName).foreground;

/** Tinted background class for an entry's brand color. */
export const createMenuTint = (item: CreatableBlock) =>
  getIconConfig(item.blockName).background;

/**
 * Keyframes for icons that have no bespoke animation: a small hop and tilt
 * whenever the entry becomes active, so every tile responds to hover.
 */
export const CreateMenuStyles = () => (
  <style>{`
    @keyframes create-menu-hop {
      0%   { transform: translateY(0) rotate(0deg) scale(1); }
      35%  { transform: translateY(-14%) rotate(-8deg) scale(1.08); }
      65%  { transform: translateY(2%) rotate(4deg) scale(1.02); }
      100% { transform: translateY(0) rotate(0deg) scale(1); }
    }
    .create-menu-hop {
      animation: create-menu-hop 0.45s cubic-bezier(0.3, 0.7, 0.4, 1);
    }
    @keyframes create-menu-shift-ripple {
      0%   { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .create-menu-shift-ripple.rippling {
      animation: create-menu-shift-ripple 0.35s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
    }
    @keyframes create-menu-fade-up {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .create-menu-fade-up {
      animation: create-menu-fade-up 0.18s ease-out;
    }
  `}</style>
);

/**
 * The entry's icon, animated while `active`. Uses the bespoke "wide" icon
 * animation where one exists, otherwise hops the static icon.
 */
export function CreateMenuIcon(props: {
  item: CreatableBlock;
  active: boolean;
  class?: string;
}) {
  const animated = () => createMenuDetails(props.item)?.animatedIcon;

  return (
    <div class={cn('flex items-center justify-center', props.class)}>
      <Show
        when={animated()}
        fallback={
          <div
            class={cn(
              'size-full [&_svg]:size-full',
              props.active && 'create-menu-hop'
            )}
          >
            <Dynamic component={props.item.icon} />
          </div>
        }
      >
        {(icon) => (
          <Dynamic
            component={icon()}
            triggerAnimation={props.active}
            class="size-full"
          />
        )}
      </Show>
    </div>
  );
}

export function CreateMenuKey(props: { item: CreatableBlock; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex items-center rounded-md border border-edge-muted px-1.5 py-px text-xxs font-normal text-ink-muted',
        props.class
      )}
    >
      <Hotkey token={props.item.hotkeyToken} />
    </span>
  );
}

export function CreateMenuSearch(props: {
  controller: VariantLauncherController;
  class?: string;
  inputClass?: string;
  placeholder?: string;
}) {
  const c = props.controller;
  return (
    <label
      class={cn(
        'flex min-w-0 flex-1 items-center gap-2.5 text-ink-muted',
        props.class
      )}
    >
      <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-extra-muted" />
      <input
        ref={c.setSearchRef}
        type="text"
        value={c.query()}
        onInput={(event) => c.setQuery(event.currentTarget.value)}
        onFocus={() => c.setSearchFocused(true)}
        onBlur={() => c.setSearchFocused(false)}
        placeholder={props.placeholder ?? 'Search what to create…'}
        class={cn(
          'peer min-w-0 flex-1 border-0 bg-transparent py-0.5 text-ink outline-none ring-0 placeholder:text-ink-placeholder focus:outline-none focus:ring-0',
          props.inputClass
        )}
      />
      <Show
        when={c.query()}
        fallback={
          <span class="flex items-center gap-1 text-xxs text-ink-extra-muted peer-focus:hidden">
            <Hotkey
              shortcut={c.hotkeys.search()}
              theme="subtle"
              class="px-1.5 py-0.5"
            />
            to search
          </span>
        }
      >
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded-sm text-ink-extra-muted hover:bg-ink/5 hover:text-ink-muted"
          aria-label="Clear search"
          onClick={() => c.setQuery('')}
        >
          <XIcon class="size-3.5" />
        </button>
      </Show>
    </label>
  );
}

function KeyCap(props: { children: JSX.Element; class?: string }) {
  return (
    <span
      class={cn(
        'flex items-center rounded-md border border-edge-muted px-1.5 py-px text-xxs font-normal',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

/** Navigation, create, and hold-shift hints; the shift cap ripples on press. */
export function CreateMenuFooter(props: {
  controller: VariantLauncherController;
  class?: string;
  children?: JSX.Element;
}) {
  const c = props.controller;
  let rippleRef: HTMLSpanElement | undefined;

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || event.repeat || !rippleRef) return;
      rippleRef.classList.remove('rippling');
      void rippleRef.offsetWidth; // reflow to restart the animation
      rippleRef.classList.add('rippling');
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div
      class={cn(
        'flex items-center gap-4 border-t border-edge-muted/60 px-5 py-2 text-xs text-ink-extra-muted/80',
        props.class
      )}
    >
      <span class="flex items-center gap-1">
        <KeyCap>
          <Hotkey shortcut={c.hotkeys.up()} class="space-x-1" />
        </KeyCap>
        <KeyCap>
          <Hotkey shortcut={c.hotkeys.down()} class="space-x-1" />
        </KeyCap>
        Navigate
      </span>
      <span class="flex items-center gap-1">
        <KeyCap>
          <Hotkey shortcut={c.hotkeys.confirm()} />
        </KeyCap>
        Create
      </span>
      <span class="hidden items-center gap-1 md:flex">
        Hold
        <span class="relative inline-flex place-items-center">
          <span
            ref={rippleRef}
            class="create-menu-shift-ripple pointer-events-none absolute inset-0 rounded-sm border border-accent opacity-0"
          />
          <KeyCap
            class={cn(
              'transition-colors duration-150',
              c.shiftHeld() && 'border-accent bg-accent/10 text-accent'
            )}
          >
            {getNormalizedKeyString({ shortcut: 'shift' })}
          </KeyCap>
        </span>
        New split
      </span>
      {props.children}
    </div>
  );
}

export function CreateMenuEmpty(props: { query: string }) {
  return (
    <div class="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
      <div class="text-sm text-ink-muted">
        Nothing matches “{props.query.trim()}”
      </div>
      <div class="text-xs text-ink-extra-muted">
        Try “doc”, “diagram”, “schedule” or “figma”
      </div>
    </div>
  );
}
