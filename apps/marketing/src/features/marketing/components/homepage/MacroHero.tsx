import Logo from '@icon/macro-logo.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Chat from '@phosphor/chats-circle.svg';
import Mail from '@phosphor/envelope.svg';
import Doc from '@phosphor/file-text.svg';
import Task from '@phosphor/list-checks.svg';
import Pause from '@phosphor/pause.svg';
import Play from '@phosphor/play.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { CONSTELLATION_TOOLS } from '../../../setup/components/WelcomeSteps';

const surfaces = [
  {
    icon: Mail,
    label: 'Email',
    x: -126,
    y: -36,
    color: '#e2efff',
    ink: '#4384db',
  },
  {
    icon: Chat,
    label: 'Chat',
    x: -72,
    y: -109,
    color: '#e7e6ff',
    ink: '#7a70d4',
  },
  {
    icon: Doc,
    label: 'Docs',
    x: 66,
    y: -110,
    color: '#fff0c9',
    ink: '#c19532',
  },
  {
    icon: Task,
    label: 'Tasks',
    x: 129,
    y: -27,
    color: '#ffe5de',
    ink: '#da8069',
  },
  {
    icon: Sparkle,
    label: 'Agents',
    x: 76,
    y: 99,
    color: '#f6e5ff',
    ink: '#ae73cb',
  },
  {
    icon: Calendar,
    label: 'Calendar',
    x: -71,
    y: 99,
    color: '#dff4e9',
    ink: '#539e78',
  },
];

/** One visual sentence: scattered tools gather, then unfold as connected work. */
export function MacroHero() {
  let scene!: HTMLDivElement;
  const [paused, setPaused] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  const [documentVisible, setDocumentVisible] = createSignal(true);
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting)
    );
    observer.observe(scene);
    const visibility = () => setDocumentVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    });
  });
  return (
    <div
      class="macro-hero-art"
      ref={scene}
      data-paused={paused() || !visible() || !documentVisible()}
    >
      <div
        class="macro-hero-scene"
        role="img"
        aria-label="Your tools come together in Macro, connecting email, chat, docs, tasks, agents, and calendar."
      >
        <div class="macro-hero-aura" />
        <svg
          class="macro-hero-connections"
          viewBox="-180 -150 360 300"
          aria-hidden="true"
        >
          <For each={surfaces}>
            {(surface) => (
              <path
                d={`M 0 0 Q ${surface.x * 0.65} 0 ${surface.x} ${surface.y}`}
              />
            )}
          </For>
        </svg>
        <For each={CONSTELLATION_TOOLS.slice(0, 8)}>
          {(tool, index) => (
            <div
              class="macro-hero-tool"
              aria-hidden="true"
              style={{
                '--x': `${(tool.x - 50) * 3.1}px`,
                '--y': `${(tool.y - 50) * 2.7}px`,
                '--turn': `${index() % 2 === 0 ? -9 : 9}deg`,
                '--tile': surfaces[index() % surfaces.length].color,
                '--tile-ink': surfaces[index() % surfaces.length].ink,
              }}
            >
              <tool.icon />
            </div>
          )}
        </For>
        <For each={surfaces}>
          {(surface) => (
            <div
              class="macro-hero-surface"
              aria-hidden="true"
              style={{
                '--x': `${surface.x}px`,
                '--y': `${surface.y}px`,
                '--tile': surface.color,
                '--tile-ink': surface.ink,
              }}
            >
              <div>
                <surface.icon />
              </div>
              <span>{surface.label}</span>
            </div>
          )}
        </For>
        <div class="macro-hero-mark" aria-hidden="true">
          <Logo />
        </div>
      </div>
      <button
        class="macro-motion-toggle"
        type="button"
        aria-label={paused() ? 'Play animation' : 'Pause animation'}
        aria-pressed={paused()}
        onClick={() => setPaused(!paused())}
      >
        <Show when={paused()} fallback={<Pause />}>
          <Play />
        </Show>
      </button>
    </div>
  );
}
