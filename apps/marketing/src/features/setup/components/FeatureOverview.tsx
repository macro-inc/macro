import Logo from '@icon/macro-logo.svg';
import CRM from '@icon/system/regular/buildings.svg';
import Calendar from '@icon/system/regular/calendar-blank.svg';
import Chat from '@icon/system/regular/chats-circle.svg';
import Check from '@icon/system/regular/check.svg';
import Database from '@icon/system/regular/database.svg';
import Mail from '@icon/system/regular/envelope.svg';
import Doc from '@icon/system/regular/file.svg';
import Folder from '@icon/system/regular/folder.svg';
import Booking from '@icon/system/regular/link.svg';
import Task from '@icon/system/regular/list-checks.svg';
import Call from '@icon/system/regular/phone-call.svg';
import Recording from '@icon/system/regular/record.svg';
import Sparkle from '@icon/system/regular/sparkle.svg';
import Sheet from '@icon/system/regular/table.svg';
import Coding from '@icon/system/regular/terminal-window.svg';
import Diagram from '@icon/system/regular/tree-structure.svg';
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
    href: '/email',
    color: 'var(--color-write)',
    source: 'Google',
    icon: Mail,
    x: 11,
    y: 45,
  },
  {
    label: 'Chat',
    href: '/channels',
    color: 'var(--color-chat)',
    source: 'Slack',
    icon: Chat,
    x: 26,
    y: 19,
  },
  {
    label: 'Sheets',
    href: '/spreadsheets',
    color: 'var(--color-success)',
    source: 'Sheets',
    icon: Sheet,
    x: 48,
    y: 6,
  },
  {
    label: 'Docs',
    href: '/documents',
    color: 'var(--color-note)',
    source: 'Notion',
    icon: Doc,
    x: 70,
    y: 19,
  },
  {
    label: 'Tasks',
    href: '/tasks',
    color: 'var(--color-task)',
    source: 'Linear',
    icon: Task,
    x: 85,
    y: 46,
  },
  {
    label: 'CRM',
    href: '/crm',
    color: 'var(--color-contact)',
    source: 'HubSpot',
    icon: CRM,
    x: 75,
    y: 78,
  },
  {
    label: 'Agents',
    href: '/agents',
    color: 'var(--color-snippet)',
    source: 'GitHub',
    icon: Sparkle,
    x: 48,
    y: 88,
  },
  {
    label: 'Calls',
    href: '/calls',
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
    href: '/calendar',
    source: 'Calendar',
    icon: Calendar,
    color: 'var(--color-note)',
    x: 26,
    y: 5,
  },
  {
    label: 'Booking links',
    href: '/booking-links',
    source: 'Booking',
    icon: Booking,
    color: 'var(--color-chat)',
    x: 50,
    y: 5,
  },
  {
    label: 'Recordings',
    href: '/calls#call-default',
    source: 'Recordings',
    icon: Recording,
    color: 'var(--color-write)',
    x: 74,
    y: 5,
  },
  {
    label: 'File storage',
    href: '/drive',
    source: 'Storage',
    icon: Folder,
    color: 'var(--color-note)',
    x: 12,
    y: 71,
  },
  {
    label: 'Databases',
    href: '/databases',
    source: 'Databases',
    icon: Database,
    color: 'var(--color-success)',
    x: 37,
    y: 71,
  },
  {
    label: 'Diagrams',
    href: '/canvas',
    source: 'Diagrams',
    icon: Diagram,
    color: 'var(--color-contact)',
    x: 29,
    y: 49,
  },
  {
    label: 'Coding agents',
    href: '/docs/AI/bring-your-own',
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
    linked?: boolean;
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
      role={props.linked ? 'navigation' : props.onSelect ? 'group' : 'img'}
      aria-label={
        props.linked
          ? 'Explore Rox features'
          : props.onSelect
            ? 'Features to try first'
            : `${items()
                .map((feature) => feature.label)
                .join(', ')}, connected in Rox`
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
                // The same coordinates as numbers, for layouts that grow the
                // light layer and have to place halos against its old box.
                '--halo-x': feature.x,
                '--halo-y': feature.y,
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
            component={props.linked ? 'a' : props.onSelect ? 'button' : 'div'}
            href={props.linked ? feature.href : undefined}
            type={props.onSelect ? 'button' : undefined}
            aria-label={
              props.linked || props.onSelect ? feature.label : undefined
            }
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
            aria-hidden={props.linked || props.onSelect ? undefined : true}
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
