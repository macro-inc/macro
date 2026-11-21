import {
  type ListControlOption,
  ListFilterDropdown,
  type ListFilterGroup,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import { Dropdown } from '@ui';
import { batch } from 'solid-js';
import {
  activeFilterCount,
  type ConversationFilterCategory,
  type ConversationFilters,
  type PullRequestFilter,
  type StatusFilter,
} from '../../core/conversation-filters';
import type { AgentsMode } from '../../core/mode';
import { SessionStatusGlyph } from '../session-status-glyph/session-status-glyph';

type FilterValue = AgentsMode | StatusFilter | PullRequestFilter;

const TYPE_OPTIONS: ListControlOption<AgentsMode>[] = [
  {
    id: 'chat',
    get label() {
      return t('agentWork.chat');
    },
    icon: () => <ChatIcon class="size-3.5" />,
  },
  {
    id: 'code',
    get label() {
      return t('agentWork.code');
    },
    icon: () => <CodeIcon class="size-3.5" />,
  },
];
const STATUS_OPTIONS: ListControlOption<StatusFilter>[] = [
  {
    id: 'waiting',
    get label() {
      return t('agentWork.waitingOnYou');
    },
    icon: () => <SessionStatusGlyph state="waiting" />,
  },
  {
    id: 'working',
    get label() {
      return t('agentWork.rowWorking');
    },
    icon: () => <SessionStatusGlyph state="working" />,
  },
  {
    id: 'unread',
    get label() {
      return t('agentWork.rowUnread');
    },
    icon: () => <SessionStatusGlyph state="unread" />,
  },
  {
    id: 'idle',
    get label() {
      return t('agentWork.idle');
    },
    icon: () => <SessionStatusGlyph state="idle" />,
  },
];
const PR_OPTIONS: ListControlOption<PullRequestFilter>[] = [
  {
    id: 'open',
    get label() {
      return t('agentWork.open');
    },
    icon: () => <GitPullRequestIcon class="size-3.5 text-success" />,
  },
  {
    id: 'draft',
    get label() {
      return t('agentWork.draft');
    },
    icon: () => <GitPullRequestIcon class="size-3.5 text-ink-muted" />,
  },
  {
    id: 'merged',
    get label() {
      return t('agentWork.merged');
    },
    icon: () => <GitMergeIcon class="size-3.5 text-note" />,
  },
  {
    id: 'closed',
    get label() {
      return t('agentWork.closed');
    },
    icon: () => <GitPullRequestIcon class="size-3.5 text-failure" />,
  },
  {
    id: 'none',
    get label() {
      return t('agentWork.noPullRequest');
    },
    icon: () => <GitPullRequestIcon class="size-3.5 text-ink-extra-muted" />,
  },
];
export const FILTER_GROUPS: ListFilterGroup<
  ConversationFilterCategory,
  FilterValue
>[] = [
  {
    id: 'type',
    get label() {
      return t('agentWork.typeFilter');
    },
    options: TYPE_OPTIONS,
  },
  {
    id: 'status',
    get label() {
      return t('agentWork.statusFilter');
    },
    options: STATUS_OPTIONS,
  },
  {
    id: 'pullRequest',
    get label() {
      return t('agentWork.pullRequestFilter');
    },
    options: PR_OPTIONS,
  },
];

export type ConversationFiltersProps = {
  filters: ConversationFilters;
  onFilterChange: (
    category: ConversationFilterCategory,
    value: FilterValue,
    selected: boolean
  ) => void;
  onClearFilters: () => void;
  showUnlistedRuns: boolean;
  onShowUnlistedRunsChange: (show: boolean) => void;
};

export function ConversationFiltersControl(props: ConversationFiltersProps) {
  const count = () =>
    activeFilterCount(props.filters) + (props.showUnlistedRuns ? 1 : 0);
  const clear = () =>
    batch(() => {
      props.onClearFilters();
      props.onShowUnlistedRunsChange(false);
    });
  return (
    <ListFilterDropdown
      label={t('agentWork.filterConversations')}
      size={count() ? 'xs' : 'icon-xs'}
      class={count() ? undefined : 'size-(--sidebar-control-size)'}
      activeCount={count()}
      groups={FILTER_GROUPS}
      isSelected={(category, value) =>
        (props.filters[category] as readonly FilterValue[]).includes(value)
      }
      selectedIds={(category) => props.filters[category]}
      onSelectionChange={props.onFilterChange}
      footer={
        <>
          <Dropdown.Group>
            <Dropdown.CheckboxItem
              closeOnSelect
              checked={props.showUnlistedRuns}
              onChange={props.onShowUnlistedRunsChange}
            >
              <span class="flex-1">{t('viewMenus.showHiddenRoutineRuns')}</span>
            </Dropdown.CheckboxItem>
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.Item onSelect={clear}>
              <Dropdown.ItemLabel class="text-failure-ink">
                {t('viewMenus.clearFilters')}
              </Dropdown.ItemLabel>
            </Dropdown.Item>
          </Dropdown.Group>
        </>
      }
    />
  );
}
