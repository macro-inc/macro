import ArticleMediumIcon from '@phosphor/article-medium.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatCircleIcon from '@phosphor/chat-circle.svg';
import FlagIcon from '@phosphor/flag.svg';
import ListBulletsIcon from '@phosphor/list-bullets.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PencilLineIcon from '@phosphor/pencil-line.svg';
import TextAaIcon from '@phosphor/text-aa.svg';
import { Dropdown, Layer } from '@ui';
import { type Component, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type PromptTemplate = {
  label: string;
  prompt: string;
  icon: Component<any>;
};

type PromptSuggestion = {
  label: string;
  text: string;
  icon: Component<any>;
};

const TEMPLATES: PromptTemplate[] = [
  {
    label: 'Workspace briefing',
    prompt:
      'Create a workspace briefing using my recent messages, emails, tasks, documents, and projects as context. Structure it with sections for important updates, decisions made, open questions, blockers or risks, items waiting on me, and recommended focus. Keep it skimmable and include references to the relevant source items when useful.',
    icon: BuildingsIcon,
  },
  {
    label: 'Weekly brief',
    prompt:
      'Create a weekly brief based on what you know about my recent work, recurring priorities, messages, tasks, and projects. Include sections for top priorities, progress made, important changes, blockers, follow-ups, people to check in with, and suggested focus for the rest of the week.',
    icon: CalendarBlankIcon,
  },
  {
    label: 'Action item list',
    prompt:
      'Create a structured action item list from the relevant context. Use columns for task, owner, deadline or timing, source, status, and suggested next step. Separate confirmed action items from possible follow-ups, and call out anything that needs clarification.',
    icon: ListChecksIcon,
  },
  {
    label: 'Reply draft',
    prompt:
      'Create a reply draft based on the relevant conversation or email. Include a concise main draft, an optional warmer version, and any follow-up questions or placeholders for missing information. Keep the tone friendly, direct, and specific.\n\nContext to use or people to mention: ',
    icon: ChatCircleIcon,
  },
  {
    label: 'Meeting brief',
    prompt:
      'Create a meeting brief for the meeting or call I mention. If I have not named a meeting, use the most relevant upcoming or recent meeting context if available; otherwise ask me which meeting to prepare for. Include background, attendees or relevant people, agenda topics, key updates, questions to ask, decisions needed, risks or blockers to raise, and recommended next steps.\n\nMeeting, call, or people to prepare for: ',
    icon: ArticleMediumIcon,
  },
  {
    label: 'Team update',
    prompt:
      'Create a concise team update I can share. Include progress since the last update, current priorities, blockers, decisions or asks, and next steps. Keep the tone clear and collaborative, and separate confirmed updates from items that need verification.\n\nTeam, project, or audience for this update: ',
    icon: ChatCircleIcon,
  },
  {
    label: 'Decision log',
    prompt:
      'Create a decision log entry from the relevant context. Include the decision, background, options considered, rationale, tradeoffs, owner, impacted people or projects, follow-up actions, and when the decision should be revisited. Clearly mark anything that is uncertain or missing.\n\nDecision, project, or people involved: ',
    icon: FlagIcon,
  },
  {
    label: 'Follow-up tracker',
    prompt:
      'Create a follow-up tracker based on recent conversations, emails, tasks, and projects. Use columns for person or team, topic, last interaction, why it matters, suggested follow-up, urgency, and source. Prioritize items that are waiting on me or likely to unblock work.\n\nPeople, teams, or topics to include: ',
    icon: ChatCircleIcon,
  },
];

const SUGGESTIONS: PromptSuggestion[] = [
  {
    label: 'Keep it brief',
    text: 'Keep the answer concise and skimmable. Use bullets when helpful and avoid unnecessary background.',
    icon: TextAaIcon,
  },
  {
    label: 'Give next steps',
    text: 'End with concrete next steps. Make each step specific, actionable, and ordered by priority.',
    icon: ListChecksIcon,
  },
  {
    label: 'Draft a response',
    text: 'Turn this into a polished response I can send. Keep it concise, friendly, and direct.',
    icon: PencilLineIcon,
  },
];

const pillClass =
  'group relative flex flex-col items-start justify-between rounded-md border border-edge-muted bg-hover/60 px-2 py-1 text-left text-ink-muted transition hover:border-edge hover:bg-hover hover:text-ink focus:outline-none focus-visible:border-accent';

function PromptChip(props: {
  label: string;
  icon: Component<any>;
  onClick?: () => void;
  trailingIcon?: Component<{ class?: string }>;
}) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <button
      class={pillClass}
      onClick={props.onClick}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <div class="flex w-full items-center justify-between gap-2">
        <Dynamic
          component={props.icon}
          class="size-3 transition"
          triggerAnimation={hovering()}
        />
        <span class="min-w-0 text-xs font-medium">{props.label}</span>
        <Show when={props.trailingIcon}>
          <Dynamic component={props.trailingIcon} class="size-2.5 shrink-0" />
        </Show>
      </div>
    </button>
  );
}

function TemplateDropdown(props: { onSelect: (prompt: string) => void }) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger class={pillClass} depth={2}>
        <div class="flex w-full items-center justify-between gap-2">
          <ListBulletsIcon class="size-4 transition" />
          <span class="min-w-0 text-xs font-medium">Templates</span>
          <CaretDownIcon class="shrink-0" />
        </div>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={TEMPLATES}>
            {(template) => (
              <Dropdown.Item
                onSelect={() => {
                  setTimeout(() => props.onSelect(template.prompt));
                }}
              >
                <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
                  <Dynamic component={template.icon} class="size-3.5" />
                </span>
                <span class="flex-1 truncate text-ink-muted">
                  {template.label}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function PromptTemplatesSection(props: {
  onSelect: (prompt: string, mode?: 'replace' | 'append') => void;
}) {
  return (
    <section class="@container/prompt-templates flex flex-wrap items-center justify-center gap-2 w-full">
      <TemplateDropdown onSelect={(prompt) => props.onSelect(prompt)} />
      <Layer depth={2}>
        <For each={SUGGESTIONS}>
          {(suggestion) => (
            <PromptChip
              label={suggestion.label}
              icon={suggestion.icon}
              onClick={() => props.onSelect(suggestion.text, 'append')}
            />
          )}
        </For>
      </Layer>
    </section>
  );
}
