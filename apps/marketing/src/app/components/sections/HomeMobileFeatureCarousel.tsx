import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconHandSwipeLeft from '../../../assets/icons/phosphor/hand-swipe-left.svg';
import IconCall from '../../../assets/icons/wide-call.svg';
import IconChat from '../../../assets/icons/wide-chat.svg';
import IconDocs from '../../../assets/icons/wide-file-md.svg';
import IconInbox from '../../../assets/icons/wide-inbox.svg';
import IconAi from '../../../assets/icons/wide-star.svg';
import IconTasks from '../../../assets/icons/wide-task.svg';
import agentsUrl from '../../../assets/mobile-feature-screens/agents.svg?url';
import bezelUrl from '../../../assets/mobile-feature-screens/bezel.svg?url';
import callsUrl from '../../../assets/mobile-feature-screens/calls.svg?url';
import docsUrl from '../../../assets/mobile-feature-screens/docs.svg?url';
import inboxUrl from '../../../assets/mobile-feature-screens/inbox.svg?url';
import messagesUrl from '../../../assets/mobile-feature-screens/messages.svg?url';
import tasksUrl from '../../../assets/mobile-feature-screens/tasks.svg?url';
import {
  InfiniteCarousel,
  type InfiniteCarouselHandle,
} from '../utils/InfiniteCarousel';

const slides = [
  {
    label: 'Inbox',
    copy: 'One inbox for emails, agents, tasks, and messages',
    title: ['One inbox for emails, agents,', 'tasks, and messages'],
    Icon: IconInbox,
    iconCaption: 'Inbox',
    iconViewBox: '0 0 18 12',
    image: inboxUrl,
  },
  {
    label: 'Messages',
    copy: 'Agents are first-class participants in channels and DMs',
    title: ['Agents are first-class', 'participants in channels & DMs'],
    Icon: IconChat,
    iconCaption: 'Chat',
    iconViewBox: '0 0 24 19',
    image: messagesUrl,
  },
  {
    label: 'Docs',
    copy: 'Agents can edit docs as collaborative peers',
    title: ['Agents can edit docs', 'as collaborative peers'],
    Icon: IconDocs,
    iconCaption: 'Docs',
    iconViewBox: '0 0 24 16.5',
    image: docsUrl,
  },
  {
    label: 'Tasks',
    copy: 'Super simple task management your team will actually use',
    title: ['Super simple task management', 'your team will actually use'],
    Icon: IconTasks,
    iconCaption: 'Tasks',
    iconViewBox: '0 0 18 12',
    image: tasksUrl,
  },
  {
    label: 'Agents',
    copy: 'Team-level memory across the workspace for agents',
    title: ['Team-level memory across', 'the workspace for agents'],
    Icon: IconAi,
    iconCaption: 'Agents',
    iconViewBox: '0 0 24 16',
    image: agentsUrl,
  },
  {
    label: 'Calls',
    copy: 'Turn every call into team memory',
    title: ['Turn every call into', 'team memory'],
    Icon: IconCall,
    iconCaption: 'Calls',
    iconViewBox: '-1.5 -1.5 18 18',
    image: callsUrl,
  },
] as const;

export function HomeMobileFeatureCarousel() {
  const [activeSlide, setActiveSlide] = createSignal(0);
  const [screenOpacity, setScreenOpacity] = createSignal(
    Array.from({ length: slides.length * 3 }, (_, index) =>
      index === slides.length ? 1 : 0
    )
  );
  const [showSwipeHint, setShowSwipeHint] = createSignal(false);
  let carousel: InfiniteCarouselHandle | undefined;
  let swipeHintFinishTimer: ReturnType<typeof setTimeout> | undefined;
  let swipeHintInterval: ReturnType<typeof setInterval> | undefined;
  let slidePreloadTimer: ReturnType<typeof setTimeout> | undefined;
  let swipeStartX: number | undefined;
  let swipeStartY: number | undefined;
  let componentSwipePointerId: number | undefined;
  let componentSwipeStartX: number | undefined;
  let componentSwipeStartY: number | undefined;
  let componentSwipeStartSlide: number | undefined;
  let componentSwipeStartedOnTrack = false;
  let componentSwipeDragging = false;
  let hasCarouselInteraction = false;

  const dismissSwipeHint = () => {
    if (swipeHintFinishTimer) clearTimeout(swipeHintFinishTimer);
    carousel?.cancelPeek();
    setShowSwipeHint(false);
  };

  const startSwipeHint = () => {
    if (
      hasCarouselInteraction ||
      showSwipeHint() ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;

    setShowSwipeHint(true);
    carousel?.peekNext();
    swipeHintFinishTimer = setTimeout(() => setShowSwipeHint(false), 1_750);
  };

  const markCarouselInteraction = () => {
    hasCarouselInteraction = true;
    if (swipeHintInterval) clearInterval(swipeHintInterval);
    dismissSwipeHint();
  };

  const beginComponentSwipe = (event: PointerEvent) => {
    if (!event.isPrimary) return;

    markCarouselInteraction();
    componentSwipePointerId = event.pointerId;
    componentSwipeStartX = event.clientX;
    componentSwipeStartY = event.clientY;
    componentSwipeStartSlide = activeSlide();
    componentSwipeStartedOnTrack =
      (event.target as Element).closest('.home-mobile-feature-track') !== null;

    // The track retains its native scroll-and-snap gesture. Every other part
    // of the hero drives the carousel on release.
  };

  const moveComponentSwipe = (event: PointerEvent) => {
    if (
      event.pointerId !== componentSwipePointerId ||
      componentSwipeStartedOnTrack
    )
      return;

    const distanceX = event.clientX - (componentSwipeStartX ?? event.clientX);
    const distanceY = event.clientY - (componentSwipeStartY ?? event.clientY);
    if (!componentSwipeDragging) {
      // Avoid borrowing vertical page scrolls; begin only once the gesture is
      // clearly horizontal, then mirror the track beneath the user's finger.
      if (
        Math.abs(distanceX) < 8 ||
        Math.abs(distanceX) <= Math.abs(distanceY) * 1.2
      )
        return;
      componentSwipeDragging = true;
      carousel?.beginExternalDrag();
    }

    carousel?.dragExternal(distanceX);
  };

  const finishComponentSwipe = (event: PointerEvent) => {
    if (event.pointerId !== componentSwipePointerId) return;

    const distanceX = event.clientX - (componentSwipeStartX ?? event.clientX);
    const distanceY = event.clientY - (componentSwipeStartY ?? event.clientY);
    const startSlide = componentSwipeStartSlide;
    const startedOnTrack = componentSwipeStartedOnTrack;
    const wasDragging = componentSwipeDragging;
    componentSwipePointerId = undefined;
    componentSwipeStartX = undefined;
    componentSwipeStartY = undefined;
    componentSwipeStartSlide = undefined;
    componentSwipeStartedOnTrack = false;
    componentSwipeDragging = false;

    // The track's native scroll has already advanced the carousel. Everywhere
    // else, keep vertical page scrolling and taps intact and handle only
    // deliberate horizontal gestures here.
    if (startedOnTrack || !wasDragging) return;

    carousel?.endExternalDrag();
    if (
      Math.abs(distanceX) < 48 ||
      Math.abs(distanceX) <= Math.abs(distanceY) * 1.5 ||
      startSlide === undefined
    ) {
      carousel?.select(startSlide ?? activeSlide());
      return;
    }

    const direction = distanceX < 0 ? 1 : -1;
    carousel?.select((startSlide + direction + slides.length) % slides.length);
  };

  const cancelComponentSwipe = (event: PointerEvent) => {
    if (event.pointerId !== componentSwipePointerId) return;
    componentSwipePointerId = undefined;
    componentSwipeStartX = undefined;
    componentSwipeStartY = undefined;
    if (componentSwipeDragging) carousel?.endExternalDrag();
    if (componentSwipeStartSlide !== undefined)
      carousel?.select(componentSwipeStartSlide);
    componentSwipeStartSlide = undefined;
    componentSwipeStartedOnTrack = false;
    componentSwipeDragging = false;
  };

  onMount(() => {
    swipeHintInterval = setInterval(startSwipeHint, 5_000);
    // The phone screens are detailed SVGs, so lazy loading makes a newly
    // swiped-to slide visibly decode late. Warm the browser cache after the
    // hero has painted, without competing with the first screen.
    slidePreloadTimer = setTimeout(() => {
      for (const slide of slides.slice(1)) {
        const image = new Image();
        image.decoding = 'async';
        image.src = slide.image;
      }
    }, 600);
  });

  onCleanup(() => {
    if (swipeHintFinishTimer) clearTimeout(swipeHintFinishTimer);
    if (swipeHintInterval) clearInterval(swipeHintInterval);
    if (slidePreloadTimer) clearTimeout(slidePreloadTimer);
  });

  return (
    <section
      aria-label="Explore Macro on mobile"
      onPointerCancel={cancelComponentSwipe}
      onPointerDown={beginComponentSwipe}
      onPointerMove={moveComponentSwipe}
      onPointerUp={finishComponentSwipe}
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '18px',
        'justify-items': 'center',
        overflow: 'hidden',
        padding: '56px 0 24px',
        position: 'relative',
        'touch-action': 'pan-y',
        width: '100%',
        'z-index': 1,
      }}
    >
      <style>{`
        .home-mobile-feature-track {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .home-mobile-feature-track::-webkit-scrollbar { display: none; }
        .home-mobile-feature-swipe-hint {
          animation: home-mobile-swipe-hand 1.6s cubic-bezier(0.22, 0.8, 0.28, 1) both;
          transform-origin: 50% 88%;
        }
        .home-mobile-feature-swipe-backdrop {
          animation: home-mobile-swipe-backdrop 1.6s cubic-bezier(0.22, 0.8, 0.28, 1) both;
        }
        @keyframes home-mobile-swipe-hand {
          0% { opacity: 0; transform: translate(-50%, -50%) translateX(22px) scale(0.88); }
          24% { opacity: 0.96; }
          54% { opacity: 1; transform: translate(-50%, -50%) translateX(-22px) scale(1.08); }
          76% { opacity: 0.86; }
          100% { opacity: 0; transform: translate(-50%, -50%) translateX(-34px) scale(0.98); }
        }
        @keyframes home-mobile-swipe-backdrop {
          0% { opacity: 0; transform: translate(-50%, -50%) translateX(22px) scale(0.88); }
          24% { opacity: 0.76; }
          54% { opacity: 0.8; transform: translate(-50%, -50%) translateX(-22px) scale(1.08); }
          76% { opacity: 0.58; }
          100% { opacity: 0; transform: translate(-50%, -50%) translateX(-34px) scale(0.98); }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-mobile-feature-track { scroll-behavior: auto; }
          .home-mobile-feature-swipe-hint { animation: none; }
        }
      `}</style>

      <div
        style={{
          'margin-left': 'calc(50% - 50vw)',
          position: 'relative',
          width: '100vw',
        }}
      >
        <InfiniteCarousel
          ariaLabel="Mobile feature views"
          class="home-mobile-feature-track"
          items={slides}
          onActiveChange={setActiveSlide}
          onReady={(handle) => {
            carousel = handle;
          }}
          onSlideVisibilityChange={setScreenOpacity}
          style={{
            'box-sizing': 'border-box',
            display: 'flex',
            overflow: 'auto',
            'overscroll-behavior-x': 'contain',
            // Keep the resting carousel as a single, edge-to-edge phone. The
            // cue briefly peeks the neighboring slide into view.
            padding: '0',
            'scroll-behavior': 'smooth',
            'scroll-snap-type': 'x mandatory',
            width: '100%',
          }}
          trackProps={{
            onPointerDown: (event) => {
              markCarouselInteraction();
              swipeStartX = event.clientX;
              swipeStartY = event.clientY;
            },
            onPointerMove: (event) => {
              if (swipeStartX === undefined || swipeStartY === undefined)
                return;

              const distanceX = Math.abs(event.clientX - swipeStartX);
              const distanceY = Math.abs(event.clientY - swipeStartY);
              if (distanceX > 24 && distanceX > distanceY * 1.5)
                markCarouselInteraction();
            },
            onPointerUp: () => {
              swipeStartX = undefined;
              swipeStartY = undefined;
            },
            onPointerCancel: () => {
              swipeStartX = undefined;
              swipeStartY = undefined;
            },
            onWheel: markCarouselInteraction,
          }}
        >
          {(slide, context) => (
            <figure
              aria-hidden={context.isClone()}
              aria-label={slide.copy}
              id={
                context.isClone()
                  ? undefined
                  : `mobile-feature-${context.logicalIndex()}`
              }
              style={{
                'align-items': 'center',
                'box-sizing': 'border-box',
                display: 'grid',
                flex: '0 0 100%',
                'justify-items': 'center',
                margin: '0',
                'min-width': '0',
                'scroll-snap-align': 'center',
                'scroll-snap-stop': 'always',
                width: '100%',
              }}
            >
              <div
                style={{
                  filter: 'drop-shadow(0 28px 34px rgb(0 0 0 / 0.45))',
                  'aspect-ratio': '982 / 1981',
                  '-webkit-mask-image':
                    'linear-gradient(to bottom, #000 0%, #000 49%, rgb(0 0 0 / 0.45) 63%, transparent 84%)',
                  'mask-image':
                    'linear-gradient(to bottom, #000 0%, #000 49%, rgb(0 0 0 / 0.45) 63%, transparent 84%)',
                  position: 'relative',
                  width: 'min(calc(100vw - 48px), 280px)',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    background: '#000',
                    'border-radius': '17.1% / 8.5%',
                    bottom: '0.4%',
                    left: '1.6%',
                    position: 'absolute',
                    right: '1.6%',
                    top: '0.4%',
                    'z-index': 0,
                  }}
                />
                <img
                  alt={`${slide.label} in Macro for mobile`}
                  decoding="async"
                  loading={
                    !context.isClone() && context.logicalIndex() === 0
                      ? 'eager'
                      : 'lazy'
                  }
                  src={slide.image}
                  style={{
                    display: 'block',
                    height: '100%',
                    // Keep the destination screen legible throughout the
                    // helper's short real-scroll preview.
                    opacity: showSwipeHint()
                      ? 1
                      : (screenOpacity()[context.physicalIndex()] ?? 0),
                    position: 'relative',
                    transition: 'opacity 160ms linear',
                    width: '100%',
                    'z-index': 1,
                  }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    '-webkit-mask': `url(${bezelUrl}) center / 100% 100% no-repeat`,
                    background:
                      'color-mix(in srgb, var(--b4) 34%, transparent)',
                    height: '100%',
                    inset: '0',
                    mask: `url(${bezelUrl}) center / 100% 100% no-repeat`,
                    'pointer-events': 'none',
                    position: 'absolute',
                    width: '100%',
                    'z-index': 2,
                  }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    background: '#000',
                    'border-radius': '0 0 14px 14px',
                    height: '3.13%',
                    left: '34%',
                    'pointer-events': 'none',
                    position: 'absolute',
                    top: '1.9%',
                    width: '32%',
                    'z-index': 3,
                  }}
                />
              </div>
            </figure>
          )}
        </InfiniteCarousel>
        <Show when={showSwipeHint()}>
          <div
            aria-hidden="true"
            class="home-mobile-feature-swipe-backdrop"
            style={{
              background:
                'radial-gradient(ellipse 60% 52% at 50% 50%, rgb(0 0 0 / 0.78) 0%, rgb(0 0 0 / 0.54) 34%, rgb(0 0 0 / 0.2) 60%, transparent 78%)',
              height: '166px',
              left: '50%',
              'pointer-events': 'none',
              position: 'absolute',
              top: '42%',
              width: '184px',
              'z-index': 3,
            }}
          />
          <div
            aria-hidden="true"
            class="home-mobile-feature-swipe-hint"
            style={{
              color: 'var(--c0)',
              left: '50%',
              'pointer-events': 'none',
              position: 'absolute',
              top: '42%',
              'z-index': 4,
            }}
          >
            <div
              style={{
                background:
                  'radial-gradient(ellipse, rgb(0 0 0 / 0.82) 0%, rgb(0 0 0 / 0.44) 36%, transparent 74%)',
                bottom: '-13px',
                filter: 'blur(7px)',
                height: '26px',
                left: '-24px',
                position: 'absolute',
                width: '94px',
                'z-index': -1,
              }}
            />
            <IconHandSwipeLeft
              aria-hidden="true"
              style={{ display: 'block', height: '62px', width: '45px' }}
            />
          </div>
        </Show>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '14px',
          'justify-items': 'center',
          'margin-top': '-160px',
          padding: '0 12px',
          position: 'relative',
          width: '100%',
          'z-index': 2,
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '2px',
            'justify-items': 'center',
            'min-height': '76px',
          }}
        >
          <div
            style={{
              'align-items': 'baseline',
              color: 'var(--a0)',
              display: 'inline-flex',
              'font-family': 'body',
              'font-size': '15px',
              'font-weight': '600',
              gap: '0.4em',
              'letter-spacing': '0.1em',
              'line-height': '1cap',
              'text-transform': 'uppercase',
            }}
          >
            <Dynamic
              component={slides[activeSlide()].Icon}
              aria-hidden="true"
              viewBox={slides[activeSlide()].iconViewBox}
              style={{
                display: 'block',
                'flex-shrink': '0',
                height: '1cap',
                width: 'auto',
              }}
            />
            <span style={{ 'line-height': '1cap', 'white-space': 'nowrap' }}>
              {slides[activeSlide()].iconCaption}
            </span>
          </div>
          <p
            aria-live="polite"
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': 'clamp(23px, 6.2vw, 28px)',
              'font-weight': '380',
              'letter-spacing': '-0.015em',
              'line-height': 1.08,
              margin: '0',
              'max-width': '32ch',
              'text-align': 'center',
              width: '100%',
            }}
          >
            <For each={slides[activeSlide()].title}>
              {(line) => <span style={{ display: 'block' }}>{line}</span>}
            </For>
          </p>
        </div>

        <div
          aria-label="Mobile feature views"
          style={{ display: 'flex', gap: '8px' }}
        >
          <For each={slides}>
            {(slide, index) => (
              <button
                aria-controls={`mobile-feature-${index()}`}
                aria-label={`Show ${slide.label}`}
                aria-pressed={activeSlide() === index()}
                onClick={() => {
                  dismissSwipeHint();
                  carousel?.select(index());
                }}
                style={{
                  background:
                    activeSlide() === index()
                      ? 'var(--a0)'
                      : 'color-mix(in srgb, var(--c4) 34%, transparent)',
                  border: '0',
                  'border-radius': '999px',
                  cursor: 'pointer',
                  height: '7px',
                  padding: '0',
                  transition:
                    'background-color 180ms ease, transform 180ms ease, width 180ms ease',
                  width: activeSlide() === index() ? '24px' : '7px',
                }}
                type="button"
              />
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
