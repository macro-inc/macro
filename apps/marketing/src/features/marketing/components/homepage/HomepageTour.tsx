import ArrowRight from '@icon/system/regular/arrow-right.svg';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import calendarScreen from '../../../../assets/homepage/calendar.webp';
import calendarScreenLight from '../../../../assets/homepage/calendar-light.webp';
import callScreen from '../../../../assets/homepage/call.webp';
import callScreenLight from '../../../../assets/homepage/call-light.webp';
import chatScreen from '../../../../assets/homepage/chat.webp';
import chatScreenLight from '../../../../assets/homepage/chat-light.webp';
import crmScreen from '../../../../assets/homepage/crm-board.webp';
import crmScreenLight from '../../../../assets/homepage/crm-board-light.webp';
import docsScreen from '../../../../assets/homepage/docs.webp';
import docsScreenLight from '../../../../assets/homepage/docs-light.webp';
import homeScreen from '../../../../assets/homepage/home.webp';
import homeScreenLight from '../../../../assets/homepage/home-light.webp';
import mailScreen from '../../../../assets/homepage/mail.webp';
import mailScreenLight from '../../../../assets/homepage/mail-light.webp';
import tasksScreen from '../../../../assets/homepage/tasks.webp';
import tasksScreenLight from '../../../../assets/homepage/tasks-light.webp';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { TutorialWallpaper } from '../TutorialWallpaper';
import './homepage-tour.css';

// `light` is the same module in the website's sample workspace, shown on the
// light palette. Its alt text describes that capture, not the dark one.
const STOPS: readonly {
  label: string;
  tutorial: TutorialVideoId;
  src: string;
  alt: string;
  light: { src: string; alt: string };
}[] = [
  {
    label: 'Home',
    tutorial: 'home',
    src: homeScreen,
    alt: 'Macro Home: one list of emails, channels, tasks and agent sessions beside an agent’s summary of today’s support tickets',
    light: {
      src: homeScreenLight,
      alt: 'Macro Home: one list of chats, channels, emails and tasks beside an agent’s answer listing the launch tasks still open',
    },
  },
  {
    label: 'Mail',
    tutorial: 'mail',
    src: mailScreen,
    alt: 'Macro Mail: an inbox split into Signal and Noise, each thread tagged',
    light: {
      src: mailScreenLight,
      alt: 'Macro Mail: the Signal inbox for three accounts, each thread tagged',
    },
  },
  {
    label: 'Chat',
    tutorial: 'chat',
    src: chatScreen,
    alt: 'Macro Chat: the launch-team channel with a thread showing its first replies inline',
    light: {
      src: chatScreenLight,
      alt: 'Macro Chat: the launch channel with replies shown inline and tasks mentioned in messages',
    },
  },
  {
    label: 'Tasks',
    tutorial: 'tasks',
    src: tasksScreen,
    alt: 'Macro Tasks: all tasks grouped by priority with due dates, projects and assignees',
    light: {
      src: tasksScreenLight,
      alt: 'Macro Tasks: all tasks in a list with status, priority and assignee',
    },
  },
  {
    label: 'Calendar',
    tutorial: 'calendar',
    src: calendarScreen,
    alt: 'Macro Calendar: a week view with upcoming events in the sidebar',
    light: {
      src: calendarScreenLight,
      alt: 'Macro Calendar: a week view with upcoming events in the sidebar',
    },
  },
  {
    label: 'Docs',
    tutorial: 'docs',
    src: docsScreen,
    alt: 'Macro Docs: a requirements doc that mentions tasks and a standup call',
    light: {
      src: docsScreenLight,
      alt: 'Macro Docs: a launch plan with tags, a checklist and owners',
    },
  },
  {
    label: 'CRM',
    tutorial: 'crm',
    src: crmScreen,
    alt: 'Macro CRM: a deals pipeline as a board with Discovery, Proposal and Negotiation columns',
    light: {
      src: crmScreenLight,
      alt: 'Macro CRM: companies on a board with Lead, Qualified, Demo and Trial columns',
    },
  },
  {
    label: 'Calls',
    tutorial: 'calls',
    src: callScreen,
    alt: 'Macro Calls: a recorded standup with participants, a summary and the recording',
    light: {
      src: callScreenLight,
      alt: 'Macro Calls: a recorded planning call with participants, a summary and the recording',
    },
  },
];

const AUTOPLAY_MS = 5000;

/**
 * The homepage's first product view: one tab per module, each showing that
 * module's app window on its own wallpaper. It advances on its own until the
 * visitor picks a tab, and never moves for visitors who prefer reduced motion.
 */
export function HomepageTour() {
  const [current, setCurrent] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [fadeStart, setFadeStart] = createSignal(false);
  const [fadeEnd, setFadeEnd] = createSignal(false);
  const tabs: HTMLButtonElement[] = [];
  let strip!: HTMLDivElement;
  let timer: ReturnType<typeof setInterval> | undefined;

  // The strip scrolls on narrow screens; its edges fade where tabs continue.
  const updateFades = () => {
    setFadeStart(strip.scrollLeft > 4);
    setFadeEnd(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4);
  };

  const show = (index: number, focus = false) => {
    const next = (index + STOPS.length) % STOPS.length;
    setCurrent(next);
    const tab = tabs[next];
    strip.scrollLeft =
      tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    if (focus) tab.focus();
    updateFades();
  };

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    setPlaying(false);
  };

  const targets: Record<string, () => number> = {
    ArrowRight: () => current() + 1,
    ArrowLeft: () => current() - 1,
    Home: () => 0,
    End: () => STOPS.length - 1,
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = targets[event.key];
    if (!target) return;
    event.preventDefault();
    stop();
    show(target(), true);
  };

  onMount(() => {
    updateFades();
    window.addEventListener('resize', updateFades);
    // Turning on reduced motion mid-visit stops the tour too.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) stop();
    };
    reducedMotion.addEventListener('change', onMotionChange);
    onCleanup(() => {
      window.removeEventListener('resize', updateFades);
      reducedMotion.removeEventListener('change', onMotionChange);
      clearInterval(timer);
    });
    if (reducedMotion.matches) return;
    setPlaying(true);
    timer = setInterval(() => {
      if (!document.hidden) show(current() + 1);
    }, AUTOPLAY_MS);
  });

  // Any visit to the controls (focus, a touch, a mouse over the tour) stops
  // the tour, so it never moves while someone is reading or using it.
  return (
    <section
      class="homepage-tour"
      aria-label="Macro, one module at a time"
      onFocusIn={stop}
      onPointerDown={stop}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') stop();
      }}
    >
      <div class="homepage-tour-wallpapers" aria-hidden="true">
        <For each={STOPS}>
          {(item, index) => (
            <div data-active={index() === current()}>
              <TutorialWallpaper tutorial={item.tutorial} />
            </div>
          )}
        </For>
      </div>
      <div class="homepage-tour-bar">
        <div
          ref={strip}
          class="homepage-tour-tabs"
          role="tablist"
          aria-label="Modules"
          data-playing={playing()}
          data-fade-start={fadeStart()}
          data-fade-end={fadeEnd()}
          onScroll={updateFades}
          onKeyDown={onKeyDown}
        >
          <For each={STOPS}>
            {(item, index) => (
              <button
                ref={(element) => {
                  tabs[index()] = element;
                }}
                type="button"
                role="tab"
                id={`homepage-tour-tab-${index()}`}
                aria-controls="homepage-tour-screen"
                aria-selected={index() === current()}
                tabIndex={index() === current() ? 0 : -1}
                onClick={() => {
                  stop();
                  show(index());
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="homepage-tour-next"
          aria-label="Next module"
          onClick={() => {
            stop();
            show(current() + 1);
          }}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
      <div
        id="homepage-tour-screen"
        class="homepage-tour-screen"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`homepage-tour-tab-${current()}`}
      >
        <For each={STOPS}>
          {(item, index) => (
            <>
              <img
                class="palette-dark-only"
                src={item.src}
                alt={item.alt}
                width="1700"
                height="916"
                loading={index() === 0 ? 'eager' : 'lazy'}
                decoding="async"
                data-active={index() === current()}
                aria-hidden={index() !== current()}
              />
              <img
                class="palette-light-only"
                src={item.light.src}
                alt={item.light.alt}
                width="1700"
                height="916"
                loading="lazy"
                decoding="async"
                data-active={index() === current()}
                aria-hidden={index() !== current()}
              />
            </>
          )}
        </For>
      </div>
    </section>
  );
}
