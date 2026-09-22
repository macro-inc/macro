import Logo from '@icon/macro-logo.svg';
import Chat from '@phosphor/chat-circle.svg';
import Task from '@phosphor/check-square.svg';
import Mail from '@phosphor/envelope.svg';
import Doc from '@phosphor/file-text.svg';
import Board from '@phosphor/kanban.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Call from '@phosphor/video-camera.svg';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { StoryContinue } from './StoryContinue';
import './feature-overview.css';

// Matching connector names let StoryStage carry the actual welcome icons here.
const features = [
  {
    label: 'Email',
    color: 'var(--color-write)',
    source: 'Google',
    icon: Mail,
    x: 14,
    y: 35,
  },
  {
    label: 'Chat',
    color: 'var(--color-chat)',
    source: 'Slack',
    icon: Chat,
    x: 32,
    y: 15,
  },
  {
    label: 'Docs',
    color: 'var(--color-note)',
    source: 'Notion',
    icon: Doc,
    x: 67,
    y: 16,
  },
  {
    label: 'Tasks',
    color: 'var(--color-task)',
    source: 'Linear',
    icon: Task,
    x: 85,
    y: 44,
  },
  {
    label: 'CRM',
    color: 'var(--color-contact)',
    source: 'HubSpot',
    icon: Board,
    x: 71,
    y: 78,
  },
  {
    label: 'Agents',
    color: 'var(--color-snippet)',
    source: 'GitHub',
    icon: Sparkle,
    x: 41,
    y: 83,
  },
  {
    label: 'Calls',
    color: 'var(--color-note)',
    source: 'Zoom',
    icon: Call,
    x: 15,
    y: 76,
  },
];

/** The workspace constellation shared by onboarding and the public homepage. */
export function FeatureConstellation() {
  return (
    <div
      class="feature-flow"
      role="img"
      aria-label="Email, chat, documents, tasks, CRM, agents, and calls, connected in Macro"
    >
      <div class="feature-flow-light" aria-hidden="true">
        <For each={features}>
          {(feature) => (
            <div
              class="feature-flow-halo"
              style={{
                left: `${feature.x}%`,
                top: `${feature.y}%`,
                '--halo-color': feature.color,
              }}
            />
          )}
        </For>
      </div>
      <div class="feature-flow-core glass" aria-hidden="true">
        <Logo />
      </div>
      <For each={features}>
        {(feature) => (
          <div
            class="feature-flow-node"
            data-tool-tile={feature.source}
            style={{
              left: `${feature.x}%`,
              top: `${feature.y}%`,
            }}
            aria-hidden="true"
          >
            <div class="feature-flow-icon glass" data-tool-surface>
              <Dynamic component={feature.icon} />
            </div>
            <span>{feature.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}

export function FeatureOverview(props: { onContinue: () => void }) {
  return (
    <section class="feature-overview">
      <FeatureConstellation />
      <header class="relative mx-auto mt-10 max-w-2xl text-center sm:mt-12">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-4xl font-[315] leading-[1.12] tracking-tight sm:text-5xl"
        >
          Your whole workspace.
          <br />
          Already connected.
        </h1>
        <p class="mt-5 text-sm text-ink-muted">
          One search. Shared context. Everything in reach.
        </p>
      </header>
      <StoryContinue label="How?" onClick={props.onContinue} />
    </section>
  );
}
