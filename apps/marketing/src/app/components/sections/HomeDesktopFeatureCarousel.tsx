import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import agentsUrl from '../../../assets/desktop-feature-screens/agents-email-triage.png';
import crmUrl from '../../../assets/desktop-feature-screens/crm-board.png';
import docsUrl from '../../../assets/desktop-feature-screens/docs-prd.png';
import emailUrl from '../../../assets/desktop-feature-screens/email-thread.png';
import messagesUrl from '../../../assets/desktop-feature-screens/messages-channel.png';
import tasksUrl from '../../../assets/desktop-feature-screens/task-detail.png';
import IconChat from '../../../assets/icons/wide-chat.svg';
import IconCompany from '../../../assets/icons/wide-company.svg';
import IconDocs from '../../../assets/icons/wide-file-md.svg';
import IconInbox from '../../../assets/icons/wide-inbox.svg';
import IconAi from '../../../assets/icons/wide-star.svg';
import IconTasks from '../../../assets/icons/wide-task.svg';
import { heroEntrance } from '../../utils/utilHeroEntrance';
import {
  InfiniteCarousel,
  type InfiniteCarouselHandle,
} from '../utils/InfiniteCarousel';

/** Keep mouse movement close to the pointer. The prior 1.85× multiplier made
 *  slides race past the cursor and amplified infinite-loop recentering. */
const MOUSE_DRAG_GAIN = 1.12;
/** A short, deliberate mouse pull commits one slide. Trackpads remain native. */
const MOUSE_DRAG_COMMIT = 52;

const slides = [
  {
    label: 'Email',
    copy: 'One inbox for emails, agents, tasks, and messages',
    title: ['One inbox for emails, agents,', 'tasks, and messages'],
    Icon: IconInbox,
    iconCaption: 'Inbox',
    iconViewBox: '0 0 18 12',
    image: emailUrl,
  },
  {
    label: 'Messages',
    copy: 'Agents are first-class participants in channels and DMs',
    title: ['Agents are first-class participants', 'in channels and DMs'],
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
    label: 'CRM',
    copy: 'Agents keep deals current from email and chat',
    title: ['Agents keep deals current', 'from email and chat'],
    Icon: IconCompany,
    iconCaption: 'CRM',
    iconViewBox: '0 0 18 12.2',
    image: crmUrl,
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
] as const;

function CarouselCaret(props: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      style={{ display: 'block' }}
    >
      <path
        d={
          props.direction === 'left'
            ? 'M14.5 5.5 8 12l6.5 6.5'
            : 'M9.5 5.5 16 12l-6.5 6.5'
        }
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      />
    </svg>
  );
}

export function HomeDesktopFeatureCarousel() {
  const [activeSlide, setActiveSlide] = createSignal(0);
  const [screenOpacity, setScreenOpacity] = createSignal(
    Array.from({ length: slides.length * 3 }, (_, index) =>
      index === slides.length ? 1 : 0
    )
  );
  let carousel: InfiniteCarouselHandle | undefined;
  let slidePreloadTimer: ReturnType<typeof setTimeout> | undefined;
  let _hasCarouselInteraction = false;
  let dragPointerId: number | undefined;
  let dragStartX = 0;
  let dragStartScrollLeft = 0;
  let dragStartSlide = 0;
  let dragMaxTravel = 0;
  let dragPointerDelta = 0;
  let dragScrollBehavior = '';
  let dragScrollSnapType = '';
  let componentSwipePointerId: number | undefined;
  let componentSwipeStartX: number | undefined;
  let componentSwipeStartY: number | undefined;
  let componentSwipeStartSlide: number | undefined;
  let componentSwipeStartedOnTrack = false;
  let componentSwipeDragging = false;

  const markCarouselInteraction = () => {
    _hasCarouselInteraction = true;
    carousel?.cancelPeek();
  };

  const finishMouseDrag = (track: HTMLDivElement, pointerId: number) => {
    if (pointerId !== dragPointerId) return;

    if (track.hasPointerCapture(pointerId))
      track.releasePointerCapture(pointerId);
    track.style.scrollBehavior = dragScrollBehavior;
    track.style.scrollSnapType = dragScrollSnapType;
    dragPointerId = undefined;

    const slideCount = slides.length;
    const pointerDelta = dragPointerDelta;
    dragMaxTravel = 0;
    dragPointerDelta = 0;

    if (Math.abs(pointerDelta) >= MOUSE_DRAG_COMMIT) {
      // Pull left to advance; pull right to go back. Use pointer movement
      // rather than scrollLeft because the infinite track can recenter itself.
      const direction = pointerDelta < 0 ? 1 : -1;
      carousel?.select((dragStartSlide + direction + slideCount) % slideCount);
      return;
    }

    carousel?.select(dragStartSlide);
  };

  const beginComponentSwipe = (event: PointerEvent) => {
    if (!event.isPrimary) return;

    markCarouselInteraction();
    componentSwipePointerId = event.pointerId;
    componentSwipeStartX = event.clientX;
    componentSwipeStartY = event.clientY;
    componentSwipeStartSlide = activeSlide();
    componentSwipeStartedOnTrack =
      (event.target as Element).closest('.home-desktop-feature-track') !== null;
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

    if (startedOnTrack || !wasDragging) return;

    carousel?.endExternalDrag();
    if (
      Math.abs(distanceX) < MOUSE_DRAG_COMMIT ||
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
    slidePreloadTimer = setTimeout(() => {
      for (const slide of slides.slice(1)) {
        const image = new Image();
        image.decoding = 'async';
        image.src = slide.image;
      }
    }, 600);
  });

  onCleanup(() => {
    if (slidePreloadTimer) clearTimeout(slidePreloadTimer);
  });

  return (
    <section
      aria-label="Explore Macro on desktop"
      data-hero-entrance="preview"
      ref={heroEntrance('preview')}
      onPointerCancel={cancelComponentSwipe}
      onPointerDown={beginComponentSwipe}
      onPointerMove={moveComponentSwipe}
      onPointerUp={finishComponentSwipe}
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '20px',
        'justify-items': 'center',
        left: '50%',
        overflow: 'hidden',
        padding: '64px 0 42px',
        position: 'relative',
        transform: 'translateX(-50%)',
        'touch-action': 'pan-y',
        // Break the carousel out of the 1160px content column. Its own
        // overflow viewport can then reveal a dragged slide all the way to
        // the screen edge; UtilWrap still clips true page overflow.
        width: '100vw',
        'z-index': 1,
      }}
    >
      <style>{`
        .home-desktop-feature-track {
          -ms-overflow-style: none;
          cursor: default;
          scrollbar-width: none;
        }
        .home-desktop-feature-track,
        .home-desktop-feature-track * {
          cursor: default;
        }
        .home-desktop-feature-track::-webkit-scrollbar { display: none; }
        .home-desktop-feature-carousel-control:hover { color: var(--c1) !important; }
        @media (prefers-reduced-motion: reduce) {
          .home-desktop-feature-track { scroll-behavior: auto; }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          width: '100%',
        }}
      >
        <InfiniteCarousel
          ariaLabel="Desktop feature views"
          class="home-desktop-feature-track"
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
            padding: '0',
            'scroll-behavior': 'smooth',
            'scroll-snap-type': 'x mandatory',
            cursor: 'default',
            'user-select': 'none',
            width: '100%',
          }}
          trackProps={{
            onPointerDown: (event) => {
              markCarouselInteraction();
              if (event.pointerType !== 'mouse' || event.button !== 0) return;

              const track = event.currentTarget;
              dragPointerId = event.pointerId;
              dragStartX = event.clientX;
              dragStartScrollLeft = track.scrollLeft;
              dragStartSlide = activeSlide();
              dragMaxTravel = 0;
              dragPointerDelta = 0;
              dragScrollBehavior = track.style.scrollBehavior;
              dragScrollSnapType = track.style.scrollSnapType;
              track.style.scrollBehavior = 'auto';
              track.style.scrollSnapType = 'none';
              track.setPointerCapture(event.pointerId);
              event.preventDefault();
            },
            onPointerMove: (event) => {
              if (event.pointerId !== dragPointerId) return;
              event.preventDefault();
              dragPointerDelta = event.clientX - dragStartX;
              dragMaxTravel = Math.max(
                dragMaxTravel,
                Math.abs(dragPointerDelta)
              );
              event.currentTarget.scrollLeft =
                dragStartScrollLeft - dragPointerDelta * MOUSE_DRAG_GAIN;
            },
            onPointerUp: (event) => {
              finishMouseDrag(event.currentTarget, event.pointerId);
            },
            onPointerCancel: (event) => {
              finishMouseDrag(event.currentTarget, event.pointerId);
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
                  : `desktop-feature-${context.logicalIndex()}`
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
                  // 1728×1084 screenshot plus a slim 3px precision frame.
                  'aspect-ratio': '1734 / 1090',
                  filter: 'drop-shadow(0 34px 42px rgb(0 0 0 / 0.5))',
                  '-webkit-mask-image':
                    'linear-gradient(to bottom, #000 0%, #000 58%, rgb(0 0 0 / 0.55) 70%, rgb(0 0 0 / 0.18) 82%, transparent 94%)',
                  'mask-image':
                    'linear-gradient(to bottom, #000 0%, #000 58%, rgb(0 0 0 / 0.55) 70%, rgb(0 0 0 / 0.18) 82%, transparent 94%)',
                  opacity: Math.max(
                    0.18,
                    screenOpacity()[context.physicalIndex()] ?? 0
                  ),
                  position: 'relative',
                  transition: 'opacity 160ms linear',
                  width: 'min(calc(100% - 40px), 1120px)',
                }}
              >
                <div
                  style={{
                    background:
                      'linear-gradient(145deg, color-mix(in srgb, var(--c1) 14%, #17191b) 0%, #111315 24%, #070809 72%, #030404 100%)',
                    'border-radius': '15px',
                    'box-shadow':
                      'inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.82), 0 18px 44px -22px rgba(0, 0, 0, 0.78)',
                    'box-sizing': 'border-box',
                    overflow: 'hidden',
                    padding: '3px',
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      'border-radius': 'inherit',
                      background:
                        'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.02) 8%, rgba(255, 255, 255, 0.13) 30%, rgba(255, 255, 255, 0.045) 68%, transparent 100%) top / 100% 1px no-repeat',
                      'box-shadow':
                        'inset 0 0 0 1px rgba(255, 255, 255, 0.035)',
                      inset: '0',
                      'pointer-events': 'none',
                      position: 'absolute',
                      'z-index': 2,
                    }}
                  />
                  <img
                    alt={slide.copy}
                    decoding="async"
                    draggable={false}
                    loading={
                      !context.isClone() && context.logicalIndex() === 0
                        ? 'eager'
                        : 'lazy'
                    }
                    onDragStart={(event) => event.preventDefault()}
                    src={slide.image}
                    style={{
                      'border-radius': '11px',
                      'box-sizing': 'border-box',
                      display: 'block',
                      height: 'auto',
                      width: '100%',
                    }}
                  />
                </div>
              </div>
            </figure>
          )}
        </InfiniteCarousel>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '22px',
          'justify-items': 'center',
          'margin-top': '-152px',
          'padding-bottom': '8px',
          position: 'relative',
          'z-index': 2,
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '14px',
            'justify-items': 'center',
            'min-height': '120px',
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
              'font-size': '34px',
              'font-weight': '360',
              'letter-spacing': '-0.015em',
              'line-height': 1.2,
              margin: '0',
              'text-align': 'center',
            }}
          >
            <For each={slides[activeSlide()].title}>
              {(line) => <span style={{ display: 'block' }}>{line}</span>}
            </For>
          </p>
        </div>

        <div
          aria-label="Desktop feature views"
          style={{ 'align-items': 'center', display: 'flex', gap: '14px' }}
        >
          <button
            aria-label="Previous feature view"
            class="home-desktop-feature-carousel-control"
            onClick={() => {
              markCarouselInteraction();
              carousel?.select(
                (activeSlide() - 1 + slides.length) % slides.length
              );
            }}
            style={{
              background: 'transparent',
              border: '0',
              color: 'var(--c4)',
              cursor: 'default',
              display: 'inline-flex',
              padding: '3px',
              transition: 'color 160ms ease',
            }}
            type="button"
          >
            <CarouselCaret direction="left" />
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <For each={slides}>
              {(slide, index) => (
                <button
                  aria-controls={`desktop-feature-${index()}`}
                  aria-label={`Show ${slide.label}`}
                  aria-pressed={activeSlide() === index()}
                  onClick={() => {
                    markCarouselInteraction();
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
          <button
            aria-label="Next feature view"
            class="home-desktop-feature-carousel-control"
            onClick={() => {
              markCarouselInteraction();
              carousel?.select((activeSlide() + 1) % slides.length);
            }}
            style={{
              background: 'transparent',
              border: '0',
              color: 'var(--c4)',
              cursor: 'default',
              display: 'inline-flex',
              padding: '3px',
              transition: 'color 160ms ease',
            }}
            type="button"
          >
            <CarouselCaret direction="right" />
          </button>
        </div>
      </div>
    </section>
  );
}
