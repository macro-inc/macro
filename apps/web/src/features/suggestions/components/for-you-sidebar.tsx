import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import LightbulbIcon from '@icon/system/regular/lightbulb.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import SunIcon from '@icon/system/regular/sun.svg';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { FOR_YOU_LISTS, type ForYouList, type ListCounts } from '../core/lists';
import type { ShownTopic } from '../core/topics';
import { Cut } from './cut';
import { topicLook } from './topic-look';

const LIST_ICONS: Record<ForYouList, Component<{ class?: string }>> = {
  today: SunIcon,
  toDo: CircleIcon,
  suggestions: SparkleIcon,
  done: CheckCircleIcon,
};

/** A list's name, as the sidebar and the page's heading show it. */
export function listName(list: ForYouList): string {
  return match(list)
    .with('today', () => t('suggestions.listToday'))
    .with('toDo', () => t('suggestions.listToDo'))
    .with('suggestions', () => t('suggestions.listSuggestions'))
    .with('done', () => t('suggestions.listDone'))
    .exhaustive();
}

/** A row's count, at its end; nothing until it is known. */
function Count(props: { value?: number; children?: JSX.Element }) {
  return (
    <span class="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-ink-extra-muted">
      {props.children}
      {props.value}
    </span>
  );
}

/** The topics that group Today's rows, with how many of each one's rows wait; choosing one shows it alone. */
function Topics(props: {
  topics: readonly ShownTopic[];
  selected?: string;
  onSelect(key: string): void;
}) {
  const [open, setOpen] = createSignal(true);

  return (
    <CollapsibleSection.Root
      sectionId="topics"
      sectionLabel={t('suggestions.topicsLabel')}
      open={open()}
      onOpenChange={setOpen}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger>
          <span class="min-w-0 truncate">{t('suggestions.topicsLabel')}</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <ViewSidebar.Nav aria-label={t('suggestions.topicsLabel')}>
          <Key each={props.topics} by={(topic) => topic.key}>
            {(topic) => {
              const selected = () => props.selected === topic().key;
              return (
                <ViewSidebar.Item
                  active={selected()}
                  aria-current={selected() ? 'page' : undefined}
                  onClick={() => props.onSelect(topic().key)}
                  data-for-you-topic={topic().key}
                >
                  <ViewSidebar.Icon>
                    <span class="flex size-4 items-center justify-center">
                      <span
                        class={cn(
                          'size-2 rounded-xs',
                          topicLook(topic().hue).square
                        )}
                      />
                    </span>
                  </ViewSidebar.Icon>
                  <Cut>
                    <span class="truncate">{topic().name}</span>
                  </Cut>
                  <Count value={topic().waiting} />
                </ViewSidebar.Item>
              );
            }}
          </Key>
        </ViewSidebar.Nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

/**
 * The For you page's sidebar: its lists with how many rows wait in each,
 * links to the person's routines, then the topics that group Today's rows.
 */
export function ForYouSidebar(props: {
  /** The list shown; undefined while a topic is shown alone. */
  list?: ForYouList;
  counts?: ListCounts;
  onSelect(list: ForYouList): void;
  /** Routine ideas Macro drafted; undefined until known. */
  ideas?: number;
  /** One of the suggestions in the feed is a routine proposed since the last visit. */
  newIdea: boolean;
  /** Saved routines; undefined until known. */
  routines?: number;
  onOpenRoutines(): void;
  topics: readonly ShownTopic[];
  /** The key of the topic shown alone. */
  topic?: string;
  onSelectTopic(key: string): void;
}) {
  const [routinesOpen, setRoutinesOpen] = createSignal(true);

  return (
    <ViewSidebar.Root reorderId="for-you" aria-label={t('suggestions.sidebar')}>
      <header class="flex shrink-0 flex-col">
        <ViewSidebar.Header>
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton class="shrink-0" />
            <ViewSidebar.Title>{t('nav.forYou')}</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>
      </header>
      <ViewSidebar.Content>
        <ViewSidebar.Section
          id="lists"
          label={t('suggestions.listsLabel')}
          headerless
        >
          <ViewSidebar.Nav aria-label={t('suggestions.listsLabel')}>
            <For each={FOR_YOU_LISTS}>
              {(list) => {
                const Icon = LIST_ICONS[list];
                return (
                  <ViewSidebar.Item
                    active={props.list === list}
                    aria-current={props.list === list ? 'page' : undefined}
                    onClick={() => props.onSelect(list)}
                    data-for-you-list={list}
                  >
                    <ViewSidebar.Icon>
                      <Icon class="size-4" />
                    </ViewSidebar.Icon>
                    <span class="min-w-0 flex-1 truncate">
                      {listName(list)}
                    </span>
                    <Count value={props.counts?.[list]} />
                  </ViewSidebar.Item>
                );
              }}
            </For>
          </ViewSidebar.Nav>
        </ViewSidebar.Section>
        <CollapsibleSection.Root
          sectionId="routines"
          sectionLabel={t('suggestions.routinesLabel')}
          open={routinesOpen()}
          onOpenChange={setRoutinesOpen}
        >
          <CollapsibleSection.Header>
            <CollapsibleSection.Trigger>
              <span class="min-w-0 truncate">
                {t('suggestions.routinesLabel')}
              </span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
          </CollapsibleSection.Header>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('suggestions.routinesLabel')}>
              <ViewSidebar.Item
                onClick={props.onOpenRoutines}
                data-for-you-routines="ideas"
              >
                <ViewSidebar.Icon>
                  <LightbulbIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">
                  {t('suggestions.routineIdeas')}
                </span>
                <Count value={props.ideas}>
                  <Show when={props.newIdea}>
                    <span
                      class="size-1.5 rounded-full bg-violet"
                      role="img"
                      aria-label={t('suggestions.newIdea')}
                    />
                  </Show>
                </Count>
              </ViewSidebar.Item>
              <ViewSidebar.Item
                onClick={props.onOpenRoutines}
                data-for-you-routines="routines"
              >
                <ViewSidebar.Icon>
                  <RepeatIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">
                  {t('suggestions.yourRoutines')}
                </span>
                <Count value={props.routines} />
              </ViewSidebar.Item>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
        <Show when={props.topics.length > 0}>
          <Topics
            topics={props.topics}
            selected={props.topic}
            onSelect={props.onSelectTopic}
          />
        </Show>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
