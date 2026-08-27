import { InboxSelector } from '@app/features/next-soup/soup-view/filters-bar/inbox-selector';
import { VIEW_TAB_LISTS } from '@app/features/next-soup/soup-view/tab-lists';
import NoiseIcon from '@icon/wide-noise.svg';
import SignalIcon from '@icon/wide-signal.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ClockIcon from '@phosphor/clock-counter-clockwise.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import RecordIcon from '@phosphor/record.svg';
import ShareIcon from '@phosphor/share-network.svg';
import SquaresIcon from '@phosphor/squares-four.svg';
import UsersIcon from '@phosphor/users-three.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { Project } from '@service-storage/generated/schemas/project';
import { cn } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ExperimentalDriveFavoritesSection } from './experimental-drive-favorites-section';
import { ExperimentalDriveTreeSection } from './experimental-drive-tree-section';
import { ExperimentalViewSidebarItems } from './experimental-view-sidebar';

type ViewNavigationItem = {
  value: string;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

const EMAIL_TAB_ICONS: Record<
  string,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  important: SignalIcon,
  noise: NoiseIcon,
  sent: PaperPlaneIcon,
  drafts: NoteIcon,
  shared: ShareIcon,
  all: EnvelopeOpenIcon,
};

const TASK_PERSONAL_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'my-tasks', label: 'My tasks', icon: RecordIcon },
  { value: 'created-by-me', label: 'Created by me', icon: NoteIcon },
  { value: 'projects', label: 'Projects', icon: FolderIcon },
];

const TASK_TEAM_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'team-tasks', label: 'Team tasks', icon: RecordIcon },
];

export type LibrarySection =
  | 'recents'
  | 'my-drive'
  | 'favorites'
  | 'shared'
  | 'images'
  | 'all';

const LIBRARY_ITEMS: readonly (ViewNavigationItem & {
  value: LibrarySection;
})[] = [
  { value: 'recents', label: 'Recents', icon: ClockIcon },
  { value: 'shared', label: 'Shared with me', icon: ShareIcon },
  { value: 'all', label: 'Everything', icon: SquaresIcon },
];

const navButtonClass = (active: boolean) =>
  cn(
    'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
    active
      ? 'bg-active text-ink'
      : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
  );

export const experimentalEmailTabs = () =>
  VIEW_TAB_LISTS.mail.filter((tab) => tab.value !== 'calendar');

/** Email list destinations: inbox picker plus Signal, Noise, Sent, and the rest. */
export function ExperimentalEmailNavigation(props: {
  activeTab?: string;
  onSelectTab: (tab: string) => void;
}) {
  return (
    <>
      <div>
        <InboxSelector inline experimentalSidebar />
      </div>
      <ExperimentalViewSidebarItems class="mt-3">
        <nav aria-label="Email views" class="flex flex-col gap-0.5">
          <For each={experimentalEmailTabs()}>
            {(tab) => {
              const active = () => props.activeTab === tab.value;
              return (
                <button
                  type="button"
                  class={navButtonClass(active())}
                  aria-pressed={active()}
                  onClick={() => props.onSelectTab(tab.value)}
                >
                  <Dynamic
                    component={EMAIL_TAB_ICONS[tab.value]}
                    class="size-4 shrink-0"
                  />
                  {tab.label}
                </button>
              );
            }}
          </For>
        </nav>
      </ExperimentalViewSidebarItems>
    </>
  );
}

/** Personal and team task destinations. */
export function ExperimentalTaskNavigation(props: {
  activeTab?: string;
  onSelectTab: (tab: string) => void;
}) {
  const [taskTeamExpanded, setTaskTeamExpanded] = createSignal(true);
  const currentTeamQuery = useCurrentTeamQuery();
  const taskTeamName = () => currentTeamQuery.data?.team.name ?? 'Team';

  return (
    <ExperimentalViewSidebarItems class="mt-0">
      <nav aria-label="Task views" class="flex flex-col gap-0.5">
        <For each={TASK_PERSONAL_ITEMS}>
          {(item) => {
            const active = () => props.activeTab === item.value;
            return (
              <button
                type="button"
                class={navButtonClass(active())}
                aria-pressed={active()}
                onClick={() => props.onSelectTab(item.value)}
              >
                <Dynamic component={item.icon} class="size-4 shrink-0" />
                {item.label}
              </button>
            );
          }}
        </For>

        <button
          type="button"
          class={cn(
            'mt-3 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink',
            TASK_TEAM_ITEMS.some((item) => item.value === props.activeTab) &&
              'text-ink'
          )}
          aria-expanded={taskTeamExpanded()}
          onClick={() => setTaskTeamExpanded((expanded) => !expanded)}
        >
          <UsersIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{taskTeamName()}</span>
          <CaretRightIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              taskTeamExpanded() && 'rotate-90'
            )}
          />
        </button>
        <Show when={taskTeamExpanded()}>
          <For each={TASK_TEAM_ITEMS}>
            {(item) => {
              const active = () => props.activeTab === item.value;
              return (
                <button
                  type="button"
                  class={cn(
                    'flex w-full shrink-0 items-center gap-2.5 rounded-xl py-2 pl-8 pr-3 text-left text-sm font-medium transition-colors',
                    active()
                      ? 'bg-active text-ink'
                      : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                  )}
                  aria-pressed={active()}
                  onClick={() => props.onSelectTab(item.value)}
                >
                  <Dynamic component={item.icon} class="size-4 shrink-0" />
                  {item.label}
                </button>
              );
            }}
          </For>
        </Show>
      </nav>
    </ExperimentalViewSidebarItems>
  );
}

/** Drive destinations: recents, shared, everything, My Drive, and favorites. */
export function ExperimentalLibraryNavigation(props: {
  section?: LibrarySection;
  activeProjectId?: string;
  onSelectSection: (section: LibrarySection) => void;
  onSelectProject: (project: Project) => void;
  onSelectFavorites: (favorites: Favorite[]) => void;
  onOpen?: () => void;
}) {
  return (
    <ExperimentalViewSidebarItems class="mt-0">
      <nav aria-label="Drive views" class="flex flex-col gap-0.5">
        <For each={LIBRARY_ITEMS}>
          {(item) => {
            const active = () => props.section === item.value;
            return (
              <button
                type="button"
                class={navButtonClass(active())}
                aria-pressed={active()}
                onClick={() => {
                  props.onSelectSection(item.value);
                  props.onOpen?.();
                }}
              >
                <Dynamic component={item.icon} class="size-4" />
                {item.label}
              </button>
            );
          }}
        </For>

        <ExperimentalDriveTreeSection
          active={props.section === 'my-drive'}
          activeProjectId={props.activeProjectId}
          onSelectRoot={() => {
            props.onSelectSection('my-drive');
            props.onOpen?.();
          }}
          onSelect={(project) => {
            props.onSelectProject(project);
            props.onOpen?.();
          }}
        />

        <ExperimentalDriveFavoritesSection
          active={props.section === 'favorites'}
          onSelectRoot={(favorites) => {
            props.onSelectFavorites(favorites);
            props.onOpen?.();
          }}
          onOpen={props.onOpen}
        />
      </nav>
    </ExperimentalViewSidebarItems>
  );
}
