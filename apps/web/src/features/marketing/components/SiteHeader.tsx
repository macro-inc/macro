import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { FEATURE_PAGES, RESOURCE_PAGES } from '../core/navigation';
import './site-navigation.css';

const EXPLORE_PAGES = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
  { href: 'https://cal.com/team/macro/macro-demo-call', label: 'Book demo' },
];

function NavigationGroup(props: {
  label: string;
  links: readonly { href: string; label: string }[];
  onNavigate: () => void;
}) {
  return (
    <div class="site-menu-group">
      <h2>{props.label}</h2>
      <For each={props.links}>
        {(link) => (
          <a
            href={link.href}
            target={link.href.startsWith('https:') ? '_blank' : '_self'}
            rel={link.href.startsWith('https:') ? 'noreferrer' : undefined}
            onClick={props.onNavigate}
          >
            {link.label}
          </a>
        )}
      </For>
    </div>
  );
}

/** Shared public navigation and app entry. */
export function SiteHeader() {
  let menu!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });

  return (
    <header class="site-header">
      <div
        ref={menu}
        class="site-menu"
        onFocusOut={(event) => {
          if (!menu.contains(event.relatedTarget as Node)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open()) {
            event.preventDefault();
            setOpen(false);
            trigger.focus();
          }
        }}
      >
        <button
          ref={trigger}
          type="button"
          class="site-menu-trigger"
          aria-label={open() ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open()}
          aria-controls="site-main-navigation"
          onClick={() => setOpen(!open())}
        >
          <span class="site-menu-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <Show when={open()}>
          <nav
            id="site-main-navigation"
            class="site-menu-panel"
            aria-label="Main navigation"
          >
            <NavigationGroup
              label="Features"
              links={FEATURE_PAGES}
              onNavigate={() => setOpen(false)}
            />
            <NavigationGroup
              label="Resources"
              links={RESOURCE_PAGES}
              onNavigate={() => setOpen(false)}
            />
            <NavigationGroup
              label="Explore"
              links={EXPLORE_PAGES}
              onNavigate={() => setOpen(false)}
            />
          </nav>
        </Show>
      </div>
      <div class="site-header-actions">
        <a class="site-nav-start" target="_self" href="/app">
          <span>Open app</span>
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 16h22M17 6l10 10-10 10"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </a>
      </div>
    </header>
  );
}
