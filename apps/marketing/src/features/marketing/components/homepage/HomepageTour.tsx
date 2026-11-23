import ArrowRight from '@icon/system/regular/arrow-right.svg';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import calendarScreen from '../../../../assets/homepage/calendar.webp';
import callScreen from '../../../../assets/homepage/call.webp';
import chatScreen from '../../../../assets/homepage/chat.webp';
import crmScreen from '../../../../assets/homepage/crm-board.webp';
import docsScreen from '../../../../assets/homepage/docs.webp';
import homeScreen from '../../../../assets/homepage/home.webp';
import mailScreen from '../../../../assets/homepage/mail.webp';
import tasksScreen from '../../../../assets/homepage/tasks.webp';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { TutorialWallpaper } from '../TutorialWallpaper';
import './homepage-tour.css';

const STOPS: readonly {
  label: string;
  tutorial: TutorialVideoId;
  src: string;
  alt: string;
}[] = [
  {
    label: 'Home',
    tutorial: 'home',
    src: homeScreen,
    alt: 'Macro Home: one list of emails, channels, tasks and agent sessions beside an agent’s summary of today’s support tickets',
  },
  {
    label: 'Mail',
    tutorial: 'mail',
    src: mailScreen,
    alt: 'Macro Mail: an inbox split into Signal and Noise, each thread tagged',
  },
  {
    label: 'Chat',
    tutorial: 'chat',
    src: chatScreen,
    alt: 'Macro Chat: the launch-team channel with a thread showing its first replies inline',
  },
  {
    label: 'Tasks',
    tutorial: 'tasks',
    src: tasksScreen,
    alt: 'Macro Tasks: all tasks grouped by priority with due dates, projects and assignees',
  },
  {
    label: 'Calendar',
    tutorial: 'calendar',
    src: calendarScreen,
    alt: 'Macro Calendar: a week view with upcoming events in the sidebar',
  },
  {
    label: 'Docs',
    tutorial: 'docs',
    src: docsScreen,
    alt: 'Macro Docs: a requirements doc that mentions tasks and a standup call',
  },
  {
    label: 'CRM',
    tutorial: 'crm',
    src: crmScreen,
    alt: 'Macro CRM: a deals pipeline as a board with Discovery, Proposal and Negotiation columns',
  },
  {
    label: 'Calls',
    tutorial: 'calls',
    src: callScreen,
    alt: 'Macro Calls: a recorded standup with participants, a summary and the recording',
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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    stop();
    show(current() + (event.key === 'ArrowRight' ? 1 : -1), true);
  };

  onMount(() => {
    updateFades();
    window.addEventListener('resize', updateFades);
    onCleanup(() => {
      window.removeEventListener('resize', updateFades);
      clearInterval(timer);
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setPlaying(true);
    timer = setInterval(() => {
      if (!document.hidden) show(current() + 1);
    }, AUTOPLAY_MS);
  });

  return (
    <section class="homepage-tour" aria-label="Macro, one module at a time">
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
        aria-labelledby={`homepage-tour-tab-${current()}`}
      >
        <For each={STOPS}>
          {(item, index) => (
            <img
              src={item.src}
              alt={item.alt}
              width="1700"
              height="916"
              loading={index() === 0 ? 'eager' : 'lazy'}
              decoding="async"
              data-active={index() === current()}
              aria-hidden={index() !== current()}
            />
          )}
        </For>
      </div>
    </section>
  );
}
