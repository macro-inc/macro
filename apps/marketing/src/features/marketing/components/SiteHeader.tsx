import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  DEMO_BOOKING_URL,
  FEATURE_PAGES,
  RESOURCE_PAGES,
  routePhoneToMobileSignup,
} from '../core/navigation';
import { DemoBookingDialog } from './DemoBookingDialog';
import './site-navigation.css';

const EXPLORE_PAGES = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
  { href: DEMO_BOOKING_URL, label: 'Book a demo' },
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
export function SiteHeader(props: { hideOpenApp?: boolean }) {
  let menu!: HTMLDivElement;
  let trigger!: HTMLAnchorElement;
  let menuOpener: HTMLElement | undefined;
  const [open, setOpen] = createSignal(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerInside = false;
  const cancelClose = () => {
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const closeMenu = () => {
    cancelClose();
    setOpen(false);
  };
  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };
  onCleanup(cancelClose);
  const hasHoverMenu = () =>
    window.matchMedia('(min-width: 768px) and (hover: hover)').matches;

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });

  return (
    <header class="site-header" data-menu-open={open()}>
      <div
        ref={menu}
        class="site-menu"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse' && hasHoverMenu()) {
            pointerInside = true;
            menuOpener = trigger;
            openMenu();
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse' || !hasHoverMenu()) return;
          pointerInside = false;
          cancelClose();
          closeTimer = setTimeout(() => {
            closeTimer = undefined;
            if (
              !pointerInside &&
              !menu.querySelector('nav')?.contains(document.activeElement)
            ) {
              setOpen(false);
            }
          }, 350);
        }}
        onFocusOut={(event) => {
          if (!pointerInside && !menu.contains(event.relatedTarget as Node))
            closeMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open()) {
            event.preventDefault();
            closeMenu();
            (menuOpener ?? trigger).focus();
          }
          if (
            event.key === 'Tab' &&
            open() &&
            window.matchMedia('(max-width: 767px)').matches
          ) {
            const links = menu.querySelectorAll<HTMLAnchorElement>('nav a');
            const last = links[links.length - 1];
            if (
              event.shiftKey &&
              document.activeElement === (menuOpener ?? trigger)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              (menuOpener ?? trigger).focus();
            }
          }
        }}
      >
        <a
          ref={trigger}
          href="/"
          target="_self"
          class="site-menu-trigger site-menu-home"
          aria-label="Macro home"
          aria-expanded={open()}
          aria-controls="site-main-navigation"
          aria-keyshortcuts="ArrowDown"
          onClick={closeMenu}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            menuOpener = trigger;
            openMenu();
            menu.querySelector<HTMLAnchorElement>('nav a')?.focus();
          }}
        >
          <span class="site-menu-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </a>
        <button
          type="button"
          class="site-menu-trigger site-menu-toggle"
          aria-label={open() ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open()}
          aria-controls="site-main-navigation"
          onClick={(event) => {
            menuOpener = event.currentTarget;
            if (open()) closeMenu();
            else openMenu();
          }}
        >
          <span class="site-menu-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <nav
          id="site-main-navigation"
          class="site-menu-panel"
          hidden={!open()}
          aria-label="Main navigation"
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && hasHoverMenu()) {
              pointerInside = true;
              cancelClose();
            }
          }}
        >
          <NavigationGroup
            label="Features"
            links={FEATURE_PAGES}
            onNavigate={closeMenu}
          />
          <NavigationGroup
            label="Resources"
            links={RESOURCE_PAGES}
            onNavigate={closeMenu}
          />
          <NavigationGroup
            label="Explore"
            links={EXPLORE_PAGES}
            onNavigate={closeMenu}
          />
        </nav>
      </div>
      <div class="site-header-actions">
        <a
          class="site-nav-demo"
          href={DEMO_BOOKING_URL}
          target="_blank"
          rel="noreferrer"
        >
          Book a demo
        </a>
        <Show when={!props.hideOpenApp}>
          <a
            class="site-nav-start site-nav-open"
            target="_self"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            <span class="site-nav-open-label">Open app</span>
            <span class="site-nav-open-footer" aria-hidden="true">
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
            </span>
          </a>
        </Show>
      </div>
      <DemoBookingDialog />
    </header>
  );
}
