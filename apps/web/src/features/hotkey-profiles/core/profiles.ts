import { t } from '@app/lib/i18n';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';

/** The views a profile can apply to; each has at most one profile on. */
export type HotkeyProfileDomain = 'email' | 'tasks';

/**
 * Where a view registers a binding. `view` keys live in the view's own scope;
 * `detail` keys live in the scope of the item open in it, for keys that item
 * defines itself (an Email thread in the reading pane has its own scope).
 */
type HotkeyProfileContext = 'view' | 'detail';

/**
 * `g` and `o` are Macro's go-to and command-menu leaders; any other leader
 * belongs to the profile, which takes over that key in its view.
 */
export type ProfileLeader = 'g' | 'o' | 'm';

/** A key, or a leader then a key. */
export type ProfileKey = ValidHotkey | readonly [ProfileLeader, ValidHotkey];

/** Runs a view's profile action; false lets the key fall through. */
export type ProfileActionHandler = (index: number) => boolean;

type ProfileTarget<Action extends string> =
  /**
   * Run the nearest command registered for the first of these tokens that can
   * run now; the key falls through when none can.
   */
  | {
      tokens: readonly HotkeyToken[];
      contexts: readonly HotkeyProfileContext[];
    }
  /**
   * A view-supplied action. With `indexed`, each key passes its position
   * (⌃1–9 passes 0–8).
   */
  | { action: Action; indexed?: true };

export type ProfileBinding<Action extends string> = {
  section: () => string;
  /** Alternatives that each do the same thing. */
  keys: readonly ProfileKey[];
  description: () => string;
  target: ProfileTarget<Action>;
  /** The Macro shortcut on the same keys in this view, which this replaces. */
  replaces?: () => string;
  /** Runs while typing, for composer keys. */
  whileTyping?: true;
};

export type HotkeyProfile<Action extends string> = {
  id: string;
  domain: HotkeyProfileDomain;
  label: () => string;
  /** The Settings toggle, which names the view it applies to. */
  toggleLabel: () => string;
  toggleDescription: () => string;
  bindings: readonly ProfileBinding<Action>[];
  /** The vendor's keys that already do the same in Macro, for Settings. */
  sameKeys: readonly ProfileKey[];
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export type SuperhumanAction =
  | 'compose'
  | 'composeInNewSplit'
  | 'showUnread'
  | 'showFavorites'
  | 'showSignal'
  | 'showFollowUps'
  | 'showReminders'
  | 'showAccount';

/** Superhuman's keys in Email. Keys Macro doesn't have an action for are left out. */
export const SUPERHUMAN = {
  id: 'superhuman',
  domain: 'email',
  label: () => t('hotkeyProfiles.superhuman'),
  toggleLabel: () => t('hotkeyProfiles.superhumanToggle'),
  toggleDescription: () => t('hotkeyProfiles.superhumanToggleDescription'),
  bindings: [
    {
      section: () => t('hotkeyProfiles.sectionConversations'),
      keys: ['u'],
      description: () => t('hotkeyProfiles.toggleRead'),
      target: {
        tokens: [
          TOKENS.entity.action.markUnread,
          TOKENS.entity.action.markRead,
        ],
        contexts: ['view', 'detail'],
      },
      replaces: () => t('hotkeyProfiles.replacedMarkUnread'),
    },
    {
      section: () => t('hotkeyProfiles.sectionMessages'),
      keys: ['c'],
      description: () => t('hotkeyProfiles.compose'),
      target: { action: 'compose' },
      replaces: () => t('hotkeyProfiles.replacedCreateMenu'),
    },
    {
      section: () => t('hotkeyProfiles.sectionMessages'),
      keys: ['r'],
      description: () => t('hotkeyProfiles.replyToSender'),
      target: { tokens: [TOKENS.email.replyToSender], contexts: ['detail'] },
      replaces: () => t('hotkeyProfiles.replacedReplyAll'),
    },
    {
      section: () => t('hotkeyProfiles.sectionLabels'),
      keys: ['l'],
      description: () => t('hotkeyProfiles.editTags'),
      target: { tokens: [TOKENS.entity.action.tags], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionLabels'),
      keys: ['v'],
      description: () => t('hotkeyProfiles.moveToFolder'),
      target: {
        tokens: [TOKENS.entity.action.moveToFolder],
        contexts: ['view'],
      },
    },
    {
      section: () => t('hotkeyProfiles.sectionFilters'),
      keys: ['shift+u'],
      description: () => t('hotkeyProfiles.showUnread'),
      target: { action: 'showUnread' },
      replaces: () => t('hotkeyProfiles.replacedMarkRead'),
    },
    {
      section: () => t('hotkeyProfiles.sectionFilters'),
      keys: ['shift+s'],
      description: () => t('hotkeyProfiles.showFavorites'),
      target: { action: 'showFavorites' },
    },
    {
      section: () => t('hotkeyProfiles.sectionFilters'),
      keys: ['shift+i'],
      description: () => t('hotkeyProfiles.showSignal'),
      target: { action: 'showSignal' },
    },
    {
      section: () => t('hotkeyProfiles.sectionFilters'),
      keys: ['shift+r'],
      description: () => t('hotkeyProfiles.showFollowUps'),
      target: { action: 'showFollowUps' },
    },
    {
      section: () => t('hotkeyProfiles.sectionFolders'),
      keys: [['g', 'h']],
      description: () => t('hotkeyProfiles.goToReminders'),
      target: { action: 'showReminders' },
      replaces: () => t('hotkeyProfiles.replacedGoToHome'),
    },
    {
      section: () => t('hotkeyProfiles.sectionCompose'),
      keys: ['shift+cmd+a'],
      description: () => t('hotkeyProfiles.attachFile'),
      target: { tokens: [TOKENS.email.attach], contexts: ['view'] },
      whileTyping: true,
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: DIGITS.map((digit) => `ctrl+${digit}` as const),
      description: () => t('hotkeyProfiles.showAccount'),
      target: { action: 'showAccount', indexed: true },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['ctrl+/'],
      description: () => t('hotkeyProfiles.copyLink'),
      target: { tokens: [TOKENS.entity.action.copyLink], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionPopOut'),
      keys: ['shift+c'],
      description: () => t('hotkeyProfiles.composeInNewSplit'),
      target: { action: 'composeInNewSplit' },
    },
  ],
  sameKeys: [
    'cmd+k',
    '/',
    'z',
    'shift+/',
    'x',
    'shift+j',
    'e',
    'shift+e',
    'h',
    's',
    'shift+3',
    'shift+m',
    'enter',
    'f',
    'o',
    'shift+o',
    ['g', 'i'],
    ['g', 'o'],
    ['g', 's'],
    ['g', 'd'],
    ['g', 't'],
    ['g', 'e'],
    ['g', 'a'],
    'shift+cmd+o',
    'shift+cmd+c',
    'shift+cmd+b',
    'shift+cmd+s',
    'shift+cmd+m',
    'shift+cmd+,',
    'cmd+enter',
    'shift+cmd+enter',
    'tab',
    'shift+tab',
    'j',
    'k',
    'n',
    'p',
    'cmd+arrowup',
    'cmd+arrowdown',
    'escape',
  ],
} as const satisfies HotkeyProfile<SuperhumanAction>;

export type LinearAction =
  | 'closeTask'
  | 'openTaskMenu'
  | 'openProjectMenu'
  | 'openPersonMenu'
  | 'openParentTask'
  | 'openSubtask'
  | 'toggleBoard'
  | 'showMyTasks'
  | 'showBacklog'
  | 'showClosed'
  | 'showAllTasks'
  | 'showBoard'
  | 'showProjects'
  | 'openSettings'
  | 'setStatus'
  | 'createTask'
  | 'assignToMe'
  | 'setStoryPoints'
  | 'setDueDate'
  | 'clearDueDate'
  | 'setDependsOn'
  | 'clearFilters'
  | 'createSubtask';

/** Linear's keys in Tasks. Keys Macro doesn't have an action for are left out. */
export const LINEAR = {
  id: 'linear',
  domain: 'tasks',
  label: () => t('hotkeyProfiles.linear'),
  toggleLabel: () => t('hotkeyProfiles.linearToggle'),
  toggleDescription: () => t('hotkeyProfiles.linearToggleDescription'),
  bindings: [
    {
      section: () => t('hotkeyProfiles.sectionGeneral'),
      keys: ['escape'],
      description: () => t('hotkeyProfiles.backToList'),
      target: { action: 'closeTask' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['o', 'i']],
      description: () => t('hotkeyProfiles.openTaskMenu'),
      target: { action: 'openTaskMenu' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['o', 'p']],
      description: () => t('hotkeyProfiles.openProjectMenu'),
      target: { action: 'openProjectMenu' },
      replaces: () => t('hotkeyProfiles.replacedOpenPeople'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['o', 'u']],
      description: () => t('hotkeyProfiles.openPersonMenu'),
      target: { action: 'openPersonMenu' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['shift+cmd+arrowup'],
      description: () => t('hotkeyProfiles.openParentTask'),
      target: { action: 'openParentTask' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['shift+cmd+arrowdown'],
      description: () => t('hotkeyProfiles.openSubtask'),
      target: { action: 'openSubtask' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['/'],
      description: () => t('hotkeyProfiles.searchTasks'),
      target: { tokens: [TOKENS.soup.openSearch], contexts: ['view'] },
      replaces: () => t('hotkeyProfiles.replacedGoToSearch'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['cmd+i'],
      description: () => t('hotkeyProfiles.toggleDetails'),
      target: { tokens: [TOKENS.block.toggleSidePanel], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: ['cmd+b'],
      description: () => t('hotkeyProfiles.toggleBoard'),
      target: { action: 'toggleBoard' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'a']],
      description: () => t('hotkeyProfiles.goToMyTasks'),
      target: { action: 'showMyTasks' },
      replaces: () => t('hotkeyProfiles.replacedGoToAgents'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'b']],
      description: () => t('hotkeyProfiles.goToBacklog'),
      target: { action: 'showBacklog' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'x']],
      description: () => t('hotkeyProfiles.goToClosed'),
      target: { action: 'showClosed' },
      replaces: () => t('hotkeyProfiles.replacedGoToExternal'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'e']],
      description: () => t('hotkeyProfiles.goToAllTasks'),
      target: { action: 'showAllTasks' },
      replaces: () => t('hotkeyProfiles.replacedGoToEmail'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'd']],
      description: () => t('hotkeyProfiles.goToBoard'),
      target: { action: 'showBoard' },
      replaces: () => t('hotkeyProfiles.replacedGoToDocuments'),
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 'p']],
      description: () => t('hotkeyProfiles.goToProjects'),
      target: { action: 'showProjects' },
    },
    {
      section: () => t('hotkeyProfiles.sectionNavigation'),
      keys: [['g', 's']],
      description: () => t('hotkeyProfiles.goToSettings'),
      target: { action: 'openSettings' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: DIGITS.slice(0, 5).map((digit) => `opt+cmd+${digit}` as const),
      description: () => t('hotkeyProfiles.setStatusNumber'),
      target: { action: 'setStatus', indexed: true },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['c'],
      description: () => t('hotkeyProfiles.newTask'),
      target: { action: 'createTask' },
      replaces: () => t('hotkeyProfiles.replacedCreateMenu'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['e'],
      description: () => t('hotkeyProfiles.editTask'),
      // An open task focuses its editor; in the list, opens the focused task.
      target: {
        tokens: [TOKENS.block.focus, TOKENS.entity.open],
        contexts: ['view'],
      },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['a'],
      description: () => t('hotkeyProfiles.assign'),
      target: { tokens: [TOKENS.entity.action.assignee], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['i'],
      description: () => t('hotkeyProfiles.assignToMe'),
      target: { action: 'assignToMe' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['l', 'shift+l'],
      description: () => t('hotkeyProfiles.changeTags'),
      target: { tokens: [TOKENS.entity.action.tags], contexts: ['view'] },
      replaces: () => t('hotkeyProfiles.replacedExpandItem'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['s'],
      description: () => t('hotkeyProfiles.changeStatus'),
      target: { tokens: [TOKENS.entity.action.status], contexts: ['view'] },
      replaces: () => t('hotkeyProfiles.replacedSort'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['p'],
      description: () => t('hotkeyProfiles.changePriority'),
      target: { tokens: [TOKENS.entity.action.priority], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+e'],
      description: () => t('hotkeyProfiles.setStoryPoints'),
      target: { action: 'setStoryPoints' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+d'],
      description: () => t('hotkeyProfiles.setDueDate'),
      target: { action: 'setDueDate' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+cmd+d'],
      description: () => t('hotkeyProfiles.removeDueDate'),
      target: { action: 'clearDueDate' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['cmd+backspace'],
      description: () => t('hotkeyProfiles.deleteTask'),
      target: { tokens: [TOKENS.entity.action.delete], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+s'],
      description: () => t('hotkeyProfiles.toggleMute'),
      target: { tokens: [TOKENS.entity.action.mute], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: [['m', 'b']],
      description: () => t('hotkeyProfiles.setDependsOn'),
      target: { action: 'setDependsOn' },
      replaces: () => t('hotkeyProfiles.replacedMoveToFolder'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['opt+shift+f'],
      description: () => t('hotkeyProfiles.clearFilters'),
      target: { action: 'clearFilters' },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['cmd+.'],
      description: () => t('hotkeyProfiles.copyTaskId'),
      target: {
        tokens: [TOKENS.entity.action.copyEntityId],
        contexts: ['view'],
      },
      replaces: () => t('hotkeyProfiles.replacedWorkspaceNavigation'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+cmd+.'],
      description: () => t('hotkeyProfiles.copyBranchName'),
      target: {
        tokens: [TOKENS.entity.action.copyBranchName],
        contexts: ['view'],
      },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+cmd+,'],
      description: () => t('hotkeyProfiles.copyLink'),
      target: { tokens: [TOKENS.entity.action.copyLink], contexts: ['view'] },
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+cmd+o'],
      description: () => t('hotkeyProfiles.createSubtask'),
      target: { action: 'createSubtask' },
      replaces: () => t('hotkeyProfiles.replacedEditProperties'),
    },
    {
      section: () => t('hotkeyProfiles.sectionIssueActions'),
      keys: ['shift+p'],
      description: () => t('hotkeyProfiles.addToProject'),
      target: {
        tokens: [TOKENS.entity.action.addToProject],
        contexts: ['view'],
      },
    },
  ],
  sameKeys: [
    'cmd+k',
    'cmd+enter',
    'enter',
    'x',
    'j',
    'k',
    'arrowup',
    'arrowdown',
    'shift+/',
    ['g', 'i'],
    'r',
    'f',
  ],
} as const satisfies HotkeyProfile<LinearAction>;

export const HOTKEY_PROFILES = [SUPERHUMAN, LINEAR] as const;

export type HotkeyProfileId = (typeof HOTKEY_PROFILES)[number]['id'];
