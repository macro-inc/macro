import { createSignal, For, type JSX, onCleanup, onMount } from 'solid-js';
import { FEATURE_PAGES, RESOURCE_PAGES } from '../core/navigation';
import './site-navigation.css';

const EXPLORE_PAGES = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
  { href: '/startups', label: 'Startups' },
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
  let glowFrame = 0;
  let glowTarget: HTMLAnchorElement | undefined;
  let pointerX = 0;
  let pointerY = 0;
  const moveGlow: JSX.EventHandler<HTMLAnchorElement, PointerEvent> = (
    event
  ) => {
    if (event.pointerType === 'touch') return;
    glowTarget = event.currentTarget;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (glowFrame) return;
    glowFrame = requestAnimationFrame(() => {
      glowFrame = 0;
      if (!glowTarget) return;
      const bounds = glowTarget.getBoundingClientRect();
      // Percentages also track correctly when Open app scales into the footer.
      glowTarget.style.setProperty(
        '--glow-x',
        `${((pointerX - bounds.left) / bounds.width) * 100}%`
      );
      glowTarget.style.setProperty(
        '--glow-y',
        `${((pointerY - bounds.top) / bounds.height) * 100}%`
      );
    });
  };
  const stopGlow = () => {
    if (glowFrame) cancelAnimationFrame(glowFrame);
    glowFrame = 0;
    glowTarget = undefined;
  };
  const centerGlow: JSX.EventHandler<HTMLAnchorElement, FocusEvent> = (
    event
  ) => {
    event.currentTarget.style.setProperty('--glow-x', '50%');
    event.currentTarget.style.setProperty('--glow-y', '50%');
  };
  onCleanup(stopGlow);

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });

  return (
    <header class="site-header" data-menu-open={open()}>
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
          if (
            event.key === 'Tab' &&
            open() &&
            window.matchMedia('(max-width: 767px)').matches
          ) {
            const links = menu.querySelectorAll<HTMLAnchorElement>('nav a');
            const last = links[links.length - 1];
            if (event.shiftKey && document.activeElement === trigger) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              trigger.focus();
            }
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
        <nav
          id="site-main-navigation"
          class="site-menu-panel"
          hidden={!open()}
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
      </div>
      <div class="site-header-actions">
        <a
          class="site-nav-demo"
          onPointerEnter={moveGlow}
          onPointerMove={moveGlow}
          onPointerLeave={stopGlow}
          onPointerCancel={stopGlow}
          onFocus={centerGlow}
          href="https://cal.com/team/macro/macro-demo-call"
          target="_blank"
          rel="noreferrer"
        >
          Book demo
        </a>
        <a
          class="site-nav-start"
          target="_self"
          href={import.meta.env.DEV ? '/onboarding-preview.html' : '/app'}
          onPointerEnter={moveGlow}
          onPointerMove={moveGlow}
          onPointerLeave={stopGlow}
          onPointerCancel={stopGlow}
          onFocus={centerGlow}
        >
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
