import { createSignal, For, onCleanup, onMount } from 'solid-js';

const SLIDES = [
  {
    label: 'Inbox',
    target: 'Home',
    title: 'One inbox for emails, agents,\ntasks, and messages',
  },
  {
    label: 'Chat',
    target: 'Chat',
    title: 'Agents are first-class participants\nin channels and DMs',
  },
  {
    label: 'Docs',
    target: 'Drive',
    title: 'Agents can edit docs\nas collaborative peers',
  },
  {
    label: 'CRM',
    target: 'Customers',
    title: 'Agents keep deals current\nfrom email and chat',
  },
  {
    label: 'Tasks',
    target: 'Tasks',
    title: 'Tasks from messages and email,\nassigned to people and agents',
  },
  {
    label: 'Agents',
    target: 'Agents',
    title: 'Agents with memory built\nfrom your workspace',
  },
];

function CarouselCaret(props: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path
        d={
          props.direction === 'left'
            ? 'M14.5 5.5 8 12l6.5 6.5'
            : 'M9.5 5.5 16 12l-6.5 6.5'
        }
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** The live-site highlights over a workspace that is always interactive. */
export function HomepageDemoCarousel(props: {
  frame: () => HTMLIFrameElement;
}) {
  const [active, setActive] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  let document: Document | null = null;
  let transition: Animation | undefined;
  let swipe: { x: number; y: number; pointerId: number } | undefined;
  const slide = () => SLIDES[active()];
  const buttonFor = (target: string) =>
    document?.querySelector<HTMLButtonElement>(
      `.dummy-rail button[aria-label="${target}"]`
    );
  const showView = () => {
    buttonFor(slide().target)?.click();
    // Show an email within Home, keeping its mixed activity sidebar visible.
    if (active() === 0) {
      const email = Array.from(
        document?.querySelectorAll<HTMLButtonElement>(
          '.dummy-sidebar button'
        ) ?? []
      ).find(
        (button) => button.textContent?.trim() === 'Next steps for our team'
      );
      email?.click();
    }
    if (slide().target === 'Drive') {
      Array.from(
        document?.querySelectorAll<HTMLButtonElement>('.dummy-main button') ??
          []
      )
        .find((button) =>
          button.textContent?.trim().startsWith('Q3 launch plan')
        )
        ?.click();
    }
    if (slide().target === 'Tasks') {
      document
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="Open task Write the launch announcement"]'
        )
        ?.click();
    }
    if (slide().target === 'Agents') {
      Array.from(
        document?.querySelectorAll<HTMLButtonElement>(
          '.dummy-sidebar button'
        ) ?? []
      )
        .find(
          (button) => button.textContent?.trim() === 'Fix the deploy pipeline'
        )
        ?.click();
    }
  };
  const select = (index: number) => {
    setActive((index + SLIDES.length) % SLIDES.length);
    showView();
    transition?.cancel();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition = props.frame().animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: 300,
        easing: 'ease-out',
      });
    }
  };

  onMount(() => {
    const frame = props.frame();
    const followNavigation = (event: Event) => {
      const target = event.target as Element | null;
      const button = target?.closest('.dummy-rail button[aria-label]');
      if (!button) return;
      const index = SLIDES.findIndex(
        (item) => item.target === button.getAttribute('aria-label')
      );
      if (index >= 0) setActive(index);
    };
    const observer = new MutationObserver(() => {
      if (!buttonFor('Home')) return;
      observer.disconnect();
      setReady(true);
      showView();
    });
    const attach = () => {
      observer.disconnect();
      document?.removeEventListener('click', followNavigation);
      document = frame.contentDocument;
      document?.addEventListener('click', followNavigation);
      if (buttonFor('Home')) {
        setReady(true);
        showView();
      } else if (document?.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    };
    frame.addEventListener('load', attach);
    attach();
    onCleanup(() => {
      document?.removeEventListener('click', followNavigation);
      observer.disconnect();
      transition?.cancel();
      frame.removeEventListener('load', attach);
    });
  });

  return (
    <div
      class="homepage-demo-carousel"
      aria-roledescription="carousel"
      role="region"
      aria-label="What you can do with Macro"
      onPointerDown={(event) => {
        if (
          !ready() ||
          !event.isPrimary ||
          event.button !== 0 ||
          (event.target as Element).closest('button')
        )
          return;
        swipe = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (!swipe || swipe.pointerId !== event.pointerId) return;
        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        swipe = undefined;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) && ready()) {
          select(active() + (dx < 0 ? 1 : -1));
        }
      }}
      onLostPointerCapture={() => {
        swipe = undefined;
      }}
      onPointerCancel={() => {
        swipe = undefined;
      }}
    >
      <div
        class="homepage-demo-slide-controls"
        onKeyDown={(event) => {
          if (
            !ready() ||
            (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
          )
            return;
          event.preventDefault();
          select(active() + (event.key === 'ArrowRight' ? 1 : -1));
        }}
      >
        <button
          type="button"
          class="homepage-demo-arrow"
          aria-label="Previous highlight"
          disabled={!ready()}
          onClick={() => select(active() - 1)}
        >
          <CarouselCaret direction="left" />
        </button>
        <For each={SLIDES}>
          {(item, index) => (
            <button
              type="button"
              class="homepage-demo-slide-dot"
              aria-label={`Show ${item.label} highlight`}
              aria-pressed={active() === index()}
              disabled={!ready()}
              onClick={() => select(index())}
            >
              <span />
            </button>
          )}
        </For>
        <button
          type="button"
          class="homepage-demo-arrow"
          aria-label="Next highlight"
          disabled={!ready()}
          onClick={() => select(active() + 1)}
        >
          <CarouselCaret direction="right" />
        </button>
      </div>
      <div
        class="homepage-demo-slide-copy"
        aria-live="polite"
        aria-atomic="true"
      >
        <h2>{slide().title}</h2>
      </div>
    </div>
  );
}
