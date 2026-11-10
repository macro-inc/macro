import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { DocumentationNavigation } from '../../documentation/components/DocumentationNavigation';
import '../../documentation/components/documentation-navigation.css';
import { DEMO_BOOKING_URL, routePhoneToMobileSignup } from '../core/navigation';
import { DemoBookingDialog } from './DemoBookingDialog';
import './site-navigation.css';

/** A single navigation for the public website and its documentation. */
export function SiteHeader(props: {
  hideOpenApp?: boolean;
  currentPath?: string;
}) {
  let menu!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);
  const [desktop, setDesktop] = createSignal(false);
  const toggleNavigation = (next: boolean) => {
    setOpen(desktop() || next);
  };
  const close = () => {
    toggleNavigation(false);
    trigger.focus();
  };
  onMount(() => {
    const resize = () => {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      if (isDesktop !== desktop()) setOpen(isDesktop);
      setDesktop(isDesktop);
    };
    window.addEventListener('resize', resize);
    onCleanup(() => {
      window.removeEventListener('resize', resize);
    });
    setDesktop(window.matchMedia('(min-width: 768px)').matches);
    setOpen(desktop());
    const searchShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        !['k', 'f'].includes(event.key.toLowerCase())
      )
        return;
      event.preventDefault();
      setOpen(true);
      const input = menu.querySelector<HTMLInputElement>(
        'input[type="search"]'
      );
      input?.focus();
      input?.select();
    };
    window.addEventListener('keydown', searchShortcut);
    onCleanup(() => window.removeEventListener('keydown', searchShortcut));
    const outside = (event: PointerEvent) => {
      if (
        window.matchMedia('(max-width: 767px)').matches &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });
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
      // Sign Up paints through its face, which grows as it lands in the footer.
      const bounds = (
        glowTarget.querySelector('.site-nav-open-face') ?? glowTarget
      ).getBoundingClientRect();
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
  return (
    <header
      class="site-header site-documentation-header"
      data-menu-open={open()}
    >
      <div
        ref={menu}
        class="site-menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open() && !desktop()) {
            event.preventDefault();
            close();
          }
          if (
            event.key !== 'Tab' ||
            !open() ||
            !window.matchMedia('(max-width: 767px)').matches
          )
            return;
          const focusable = Array.from(
            menu.querySelectorAll<HTMLElement>('button,input,a')
          ).filter((node) => node.getClientRects().length > 0);
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === trigger) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            trigger.focus();
          }
        }}
      >
        <Show when={!desktop()}>
          <button
            ref={trigger}
            type="button"
            class="site-menu-trigger site-menu-toggle"
            aria-label={open() ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open()}
            aria-controls="site-main-navigation"
            onClick={() => toggleNavigation(!open())}
          >
            <span class="site-menu-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </Show>
        <nav
          id="site-main-navigation"
          class="documentation-navigation"
          aria-hidden={!open()}
          inert={!open()}
          aria-label="Main navigation"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('a') &&
              window.matchMedia('(max-width: 767px)').matches
            )
              setOpen(false);
          }}
        >
          <div class="doc-nav-scroll">
            <DocumentationNavigation currentPath={props.currentPath ?? '/'} />
          </div>
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
          href={DEMO_BOOKING_URL}
          target="_blank"
          rel="noreferrer"
        >
          Book a demo
        </a>
        <Show when={!props.hideOpenApp}>
          <a
            class="site-nav-open"
            onPointerEnter={moveGlow}
            onPointerMove={moveGlow}
            onPointerLeave={stopGlow}
            onPointerCancel={stopGlow}
            onFocus={centerGlow}
            target="_self"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            <span class="site-nav-open-label">Sign Up</span>
            <span class="site-nav-open-face" aria-hidden="true">
              <span>Sign Up</span>
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
