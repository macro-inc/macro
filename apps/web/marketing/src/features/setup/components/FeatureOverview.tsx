import Logo from '@icon/macro-logo.svg';
import Sheet from '@icon/wide-spreadsheet.svg';
import CRM from '@phosphor/buildings.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Chat from '@phosphor/chats-circle.svg';
import Check from '@phosphor/check.svg';
import Database from '@phosphor/database.svg';
import Mail from '@phosphor/envelope.svg';
import Doc from '@phosphor/file.svg';
import Folder from '@phosphor/folder.svg';
import Booking from '@phosphor/link.svg';
import Task from '@phosphor/list-checks.svg';
import Call from '@phosphor/phone-call.svg';
import Recording from '@phosphor/record.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Coding from '@phosphor/terminal-window.svg';
import Diagram from '@phosphor/tree-structure.svg';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ContinueButton } from '../flow/shared';
import { createWorkspaceAccent } from '../primitives/workspaceAccent';
import { WorkspaceTexture } from './WorkspaceTexture';
import './feature-overview.css';

// Matching connector names let StoryStage carry the actual welcome icons here.
const features = [
  {
    label: 'Email',
    color: 'var(--color-write)',
    source: 'Google',
    icon: Mail,
    x: 11,
    y: 45,
  },
  {
    label: 'Chat',
    color: 'var(--color-chat)',
    source: 'Slack',
    icon: Chat,
    x: 26,
    y: 19,
  },
  {
    label: 'Sheets',
    color: 'var(--color-success)',
    source: 'Sheets',
    icon: Sheet,
    x: 48,
    y: 6,
  },
  {
    label: 'Docs',
    color: 'var(--color-note)',
    source: 'Notion',
    icon: Doc,
    x: 70,
    y: 19,
  },
  {
    label: 'Tasks',
    color: 'var(--color-task)',
    source: 'Linear',
    icon: Task,
    x: 85,
    y: 46,
  },
  {
    label: 'CRM',
    color: 'var(--color-contact)',
    source: 'HubSpot',
    icon: CRM,
    x: 75,
    y: 78,
  },
  {
    label: 'Agents',
    color: 'var(--color-snippet)',
    source: 'GitHub',
    icon: Sparkle,
    x: 48,
    y: 88,
  },
  {
    label: 'Calls',
    color: 'var(--color-note)',
    source: 'Zoom',
    icon: Call,
    x: 22,
    y: 78,
  },
];

// The public overview has room for the full workspace; onboarding stays compact.
const expandedPositions = [
  [12, 27],
  [37, 27],
  [63, 27],
  [88, 27],
  [92, 49],
  [63, 71],
  [88, 71],
  [8, 49],
];
const expandedFeatures = [
  ...features.map((feature, index) => ({
    ...feature,
    x: expandedPositions[index][0],
    y: expandedPositions[index][1],
  })),
  {
    label: 'Calendar',
    source: 'Calendar',
    icon: Calendar,
    color: 'var(--color-note)',
    x: 26,
    y: 5,
  },
  {
    label: 'Booking links',
    source: 'Booking',
    icon: Booking,
    color: 'var(--color-chat)',
    x: 50,
    y: 5,
  },
  {
    label: 'Recordings',
    source: 'Recordings',
    icon: Recording,
    color: 'var(--color-write)',
    x: 74,
    y: 5,
  },
  {
    label: 'File storage',
    source: 'Storage',
    icon: Folder,
    color: 'var(--color-note)',
    x: 12,
    y: 71,
  },
  {
    label: 'Databases',
    source: 'Databases',
    icon: Database,
    color: 'var(--color-success)',
    x: 37,
    y: 71,
  },
  {
    label: 'Diagrams',
    source: 'Diagrams',
    icon: Diagram,
    color: 'var(--color-contact)',
    x: 29,
    y: 49,
  },
  {
    label: 'Coding agents',
    source: 'Coding',
    icon: Coding,
    color: 'var(--color-task)',
    x: 71,
    y: 49,
  },
];

/** The workspace constellation shared by onboarding and the public homepage. */
export function FeatureConstellation(
  props: {
    expanded?: boolean;
    textured?: boolean;
    accent?: string;
    selected?: readonly string[];
    onSelect?: (label: string) => void;
  } = {}
) {
  const noiseId = createUniqueId();
  const items = () => (props.expanded ? expandedFeatures : features);
  return (
    <div
      class="feature-flow"
      classList={{ 'feature-flow-expanded': props.expanded }}
      role={props.onSelect ? 'group' : 'img'}
      aria-label={
        props.onSelect
          ? 'Features to try first'
          : `${items()
              .map((feature) => feature.label)
              .join(', ')}, connected in Macro`
      }
    >
      <div class="feature-flow-light" aria-hidden="true">
        <For each={items()}>
          {(feature) => (
            <div
              class="feature-flow-halo"
              style={{
                left: `${feature.x}%`,
                top: `${feature.y}%`,
                '--halo-color': props.accent ?? feature.color,
              }}
            />
          )}
        </For>
      </div>
      <Show when={props.textured}>
        <div class="feature-flow-texture" aria-hidden="true">
          <WorkspaceTexture
            accent={props.accent ?? 'var(--color-ink)'}
            filterId={noiseId}
          />
        </div>
      </Show>
      <div class="feature-flow-core glass" aria-hidden="true">
        <Logo />
      </div>
      <For each={items()}>
        {(feature) => (
          <Dynamic
            component={props.onSelect ? 'button' : 'div'}
            type={props.onSelect ? 'button' : undefined}
            aria-label={props.onSelect ? feature.label : undefined}
            aria-pressed={
              props.onSelect
                ? (props.selected?.includes(feature.label) ?? false)
                : undefined
            }
            onClick={() => props.onSelect?.(feature.label)}
            class="feature-flow-node"
            data-tool-tile={feature.source}
            style={{
              left: `${feature.x}%`,
              top: `${feature.y}%`,
            }}
            aria-hidden={props.onSelect ? undefined : true}
          >
            <div class="feature-flow-icon glass" data-tool-surface>
              <Dynamic component={feature.icon} />
              <Show
                when={props.onSelect && props.selected?.includes(feature.label)}
              >
                <span class="feature-flow-check" aria-hidden="true">
                  <Check />
                </span>
              </Show>
            </div>
            <span>{feature.label}</span>
          </Dynamic>
        )}
      </For>
    </div>
  );
}

export function FeatureOverview(props: {
  onContinue: (features: string[]) => void;
}) {
  const { accent } = createWorkspaceAccent();
  // Keep the user's starting interests through Back and Google redirects.
  const [selected, setSelected] = makePersisted(createSignal<string[]>([]), {
    name: 'macro:onboarding-features',
    storage: sessionStorage,
    deserialize: (value) => {
      try {
        const saved: unknown = JSON.parse(value);
        return Array.isArray(saved)
          ? expandedFeatures
              .filter((feature) => saved.includes(feature.label))
              .map((feature) => feature.label)
          : [];
      } catch {
        return [];
      }
    },
  });
  return (
    <section
      class="feature-overview"
      style={{ '--feature-accent': accent().color }}
    >
      <FeatureConstellation
        textured
        expanded
        accent={accent().color}
        selected={selected()}
        onSelect={(label) =>
          setSelected((current) =>
            current.includes(label)
              ? current.filter((item) => item !== label)
              : [...current, label]
          )
        }
      />
      <header class="relative mx-auto mt-4 pb-6 text-center sm:mt-6">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[30px] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance] sm:text-[36px]"
        >
          Which features do you want to try first?
        </h1>
        <div class="feature-overview-description mx-auto mt-5 max-w-lg text-sm leading-6 text-ink-muted sm:text-[15px]">
          <p>Choose as many as you like. You can try the rest anytime.</p>
        </div>
      </header>
      <ContinueButton
        label="Continue"
        onClick={() => props.onContinue([...selected()])}
      />
    </section>
  );
}
