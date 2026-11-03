import { t } from '@app/lib/i18n';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';

/** The views a profile can apply to; each has at most one profile on. */
export type HotkeyProfileDomain = 'email' | 'tasks';

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
  | { tokens: readonly HotkeyToken[] }
  /**
   * A view-supplied action. With `indexed`, each key passes its position
   * (⌃1–9 passes 0–8).
   */
  | { action: Action; indexed?: true };

/** A group of a vendor's keys, named as the vendor names it. */
type ProfileSection = () => string;

const SECTION = {
  actions: () => t('hotkeyProfiles.sectionActions'),
  general: () => t('hotkeyProfiles.sectionGeneral'),
  navigation: () => t('hotkeyProfiles.sectionNavigation'),
  conversations: () => t('hotkeyProfiles.sectionConversations'),
  labels: () => t('hotkeyProfiles.sectionLabels'),
  messages: () => t('hotkeyProfiles.sectionMessages'),
  compose: () => t('hotkeyProfiles.sectionCompose'),
  popOut: () => t('hotkeyProfiles.sectionPopOut'),
  folders: () => t('hotkeyProfiles.sectionFolders'),
  windows: () => t('hotkeyProfiles.sectionWindows'),
  filters: () => t('hotkeyProfiles.sectionFilters'),
  issueActions: () => t('hotkeyProfiles.sectionIssueActions'),
} satisfies Record<string, ProfileSection>;

export type ProfileBinding<Action extends string> = {
  section: ProfileSection;
  /** Alternatives that each do the same thing. */
  keys: readonly ProfileKey[];
  description: () => string;
  target: ProfileTarget<Action>;
  /** The Macro shortcut on the same keys in this view, which this replaces. */
  replaces?: () => string;
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
  sameKeys: readonly SameProfileKey[];
  /** The vendor's sections in its own order; Settings lists keys by these. */
  sections: readonly ProfileSection[];
};

/** A vendor key that Macro already uses for the same thing. */
export type SameProfileKey = {
  section: ProfileSection;
  keys: readonly ProfileKey[];
  description: () => string;
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
      section: SECTION.messages,
      keys: ['c'],
      description: () => t('hotkeyProfiles.compose'),
      target: { action: 'compose' },
      replaces: () => t('hotkeyProfiles.replacedCreateMenu'),
    },
    {
      section: SECTION.labels,
      keys: ['l'],
      description: () => t('hotkeyProfiles.editTags'),
      target: { tokens: [TOKENS.entity.action.tags] },
    },
    {
      section: SECTION.labels,
      keys: ['v'],
      description: () => t('hotkeyProfiles.moveToFolder'),
      target: {
        tokens: [TOKENS.entity.action.moveToFolder],
      },
    },
    {
      section: SECTION.filters,
      keys: ['shift+u'],
      description: () => t('hotkeyProfiles.showUnread'),
      target: { action: 'showUnread' },
    },
    {
      section: SECTION.filters,
      keys: ['shift+s'],
      description: () => t('hotkeyProfiles.showFavorites'),
      target: { action: 'showFavorites' },
    },
    {
      section: SECTION.filters,
      keys: ['shift+i'],
      description: () => t('hotkeyProfiles.showSignal'),
      target: { action: 'showSignal' },
    },
    {
      section: SECTION.filters,
      keys: ['shift+r'],
      description: () => t('hotkeyProfiles.showFollowUps'),
      target: { action: 'showFollowUps' },
    },
    {
      section: SECTION.folders,
      keys: [['g', 'h']],
      description: () => t('hotkeyProfiles.goToReminders'),
      target: { action: 'showReminders' },
      replaces: () => t('hotkeyProfiles.replacedGoToHome'),
    },
    {
      section: SECTION.navigation,
      keys: DIGITS.map((digit) => `ctrl+${digit}` as const),
      description: () => t('hotkeyProfiles.showAccount'),
      target: { action: 'showAccount', indexed: true },
    },
    {
      section: SECTION.windows,
      keys: ['ctrl+/'],
      description: () => t('hotkeyProfiles.copyLink'),
      target: { tokens: [TOKENS.entity.action.copyLink] },
    },
    {
      section: SECTION.popOut,
      keys: ['shift+c'],
      description: () => t('hotkeyProfiles.composeInNewSplit'),
      target: { action: 'composeInNewSplit' },
    },
  ],
  sameKeys: [
    {
      section: SECTION.actions,
      keys: ['/'],
      description: () => t('hotkeyProfiles.searchEmail'),
    },
    {
      section: SECTION.actions,
      keys: ['z'],
      description: () => t('hotkeyProfiles.undo'),
    },
    {
      section: SECTION.navigation,
      keys: ['j'],
      description: () => t('hotkeyProfiles.nextConversation'),
    },
    {
      section: SECTION.navigation,
      keys: ['k'],
      description: () => t('hotkeyProfiles.previousConversation'),
    },
    {
      section: SECTION.navigation,
      keys: ['n'],
      description: () => t('hotkeyProfiles.nextMessage'),
    },
    {
      section: SECTION.navigation,
      keys: ['p'],
      description: () => t('hotkeyProfiles.previousMessage'),
    },
    {
      section: SECTION.navigation,
      keys: ['enter'],
      description: () => t('hotkeyProfiles.openConversation'),
    },
    {
      section: SECTION.navigation,
      keys: ['escape'],
      description: () => t('hotkeyProfiles.back'),
    },
    {
      section: SECTION.navigation,
      keys: ['tab'],
      description: () => t('hotkeyProfiles.nextTab'),
    },
    {
      section: SECTION.navigation,
      keys: ['shift+tab'],
      description: () => t('hotkeyProfiles.previousTab'),
    },
    {
      section: SECTION.navigation,
      keys: ['cmd+arrowup'],
      description: () => t('hotkeyProfiles.jumpToTop'),
    },
    {
      section: SECTION.navigation,
      keys: ['cmd+arrowdown'],
      description: () => t('hotkeyProfiles.jumpToBottom'),
    },
    {
      section: SECTION.conversations,
      keys: ['e'],
      description: () => t('hotkeyProfiles.markDone'),
    },
    {
      section: SECTION.conversations,
      keys: ['u'],
      description: () => t('hotkeyProfiles.toggleRead'),
    },
    {
      section: SECTION.conversations,
      keys: ['shift+e'],
      description: () => t('hotkeyProfiles.markNotDone'),
    },
    {
      section: SECTION.conversations,
      keys: ['h'],
      description: () => t('hotkeyProfiles.remindMe'),
    },
    {
      section: SECTION.conversations,
      keys: ['s'],
      description: () => t('hotkeyProfiles.favorite'),
    },
    {
      section: SECTION.conversations,
      keys: ['shift+m'],
      description: () => t('hotkeyProfiles.mute'),
    },
    {
      section: SECTION.conversations,
      keys: ['shift+3'],
      description: () => t('hotkeyProfiles.deleteConversation'),
    },
    {
      section: SECTION.conversations,
      keys: ['x'],
      description: () => t('hotkeyProfiles.selectConversation'),
    },
    {
      section: SECTION.messages,
      keys: ['r'],
      description: () => t('hotkeyProfiles.replyToSender'),
    },
    {
      section: SECTION.messages,
      keys: ['enter'],
      description: () => t('hotkeyProfiles.replyAll'),
    },
    {
      section: SECTION.messages,
      keys: ['f'],
      description: () => t('hotkeyProfiles.forward'),
    },
    {
      section: SECTION.messages,
      keys: ['o'],
      description: () => t('hotkeyProfiles.expandMessage'),
    },
    {
      section: SECTION.messages,
      keys: ['shift+o'],
      description: () => t('hotkeyProfiles.expandAllMessages'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+o'],
      description: () => t('hotkeyProfiles.editTo'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+c'],
      description: () => t('hotkeyProfiles.editCc'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+b'],
      description: () => t('hotkeyProfiles.editBcc'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+s'],
      description: () => t('hotkeyProfiles.editSubject'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+u'],
      description: () => t('hotkeyProfiles.attachFile'),
    },
    {
      section: SECTION.compose,
      keys: ['shift+cmd+,'],
      description: () => t('hotkeyProfiles.discardDraft'),
    },
    {
      section: SECTION.compose,
      keys: ['cmd+enter'],
      description: () => t('hotkeyProfiles.send'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 'i']],
      description: () => t('hotkeyProfiles.showSignal'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 'o']],
      description: () => t('hotkeyProfiles.goToNoise'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 's']],
      description: () => t('hotkeyProfiles.showFavorites'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 'd']],
      description: () => t('hotkeyProfiles.goToDrafts'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 't']],
      description: () => t('hotkeyProfiles.goToSent'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 'e']],
      description: () => t('hotkeyProfiles.goToArchived'),
    },
    {
      section: SECTION.folders,
      keys: [['g', 'a']],
      description: () => t('hotkeyProfiles.goToAllMail'),
    },
  ],
  sections: [
    SECTION.actions,
    SECTION.navigation,
    SECTION.conversations,
    SECTION.labels,
    SECTION.messages,
    SECTION.compose,
    SECTION.popOut,
    SECTION.folders,
    SECTION.windows,
    SECTION.filters,
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
      section: SECTION.general,
      keys: ['escape'],
      description: () => t('hotkeyProfiles.backToList'),
      target: { action: 'closeTask' },
    },
    {
      section: SECTION.navigation,
      keys: [['o', 'i']],
      description: () => t('hotkeyProfiles.openTaskMenu'),
      target: { action: 'openTaskMenu' },
    },
    {
      section: SECTION.navigation,
      keys: [['o', 'p']],
      description: () => t('hotkeyProfiles.openProjectMenu'),
      target: { action: 'openProjectMenu' },
      replaces: () => t('hotkeyProfiles.replacedOpenPeople'),
    },
    {
      section: SECTION.navigation,
      keys: [['o', 'u']],
      description: () => t('hotkeyProfiles.openPersonMenu'),
      target: { action: 'openPersonMenu' },
    },
    {
      section: SECTION.navigation,
      keys: ['shift+cmd+arrowup'],
      description: () => t('hotkeyProfiles.openParentTask'),
      target: { action: 'openParentTask' },
    },
    {
      section: SECTION.navigation,
      keys: ['shift+cmd+arrowdown'],
      description: () => t('hotkeyProfiles.openSubtask'),
      target: { action: 'openSubtask' },
    },
    {
      section: SECTION.navigation,
      keys: ['/'],
      description: () => t('hotkeyProfiles.searchTasks'),
      target: { tokens: [TOKENS.soup.openSearch] },
      replaces: () => t('hotkeyProfiles.replacedGoToSearch'),
    },
    {
      section: SECTION.navigation,
      keys: ['cmd+i'],
      description: () => t('hotkeyProfiles.toggleDetails'),
      target: { tokens: [TOKENS.block.toggleSidePanel] },
    },
    {
      section: SECTION.navigation,
      keys: ['cmd+b'],
      description: () => t('hotkeyProfiles.toggleBoard'),
      target: { action: 'toggleBoard' },
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'a']],
      description: () => t('hotkeyProfiles.goToMyTasks'),
      target: { action: 'showMyTasks' },
      replaces: () => t('hotkeyProfiles.replacedGoToAgents'),
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'b']],
      description: () => t('hotkeyProfiles.goToBacklog'),
      target: { action: 'showBacklog' },
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'x']],
      description: () => t('hotkeyProfiles.goToClosed'),
      target: { action: 'showClosed' },
      replaces: () => t('hotkeyProfiles.replacedGoToExternal'),
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'e']],
      description: () => t('hotkeyProfiles.goToAllTasks'),
      target: { action: 'showAllTasks' },
      replaces: () => t('hotkeyProfiles.replacedGoToEmail'),
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'd']],
      description: () => t('hotkeyProfiles.goToBoard'),
      target: { action: 'showBoard' },
      replaces: () => t('hotkeyProfiles.replacedGoToDocuments'),
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'p']],
      description: () => t('hotkeyProfiles.goToProjects'),
      target: { action: 'showProjects' },
    },
    {
      section: SECTION.navigation,
      keys: [['g', 's']],
      description: () => t('hotkeyProfiles.goToSettings'),
      target: { action: 'openSettings' },
    },
    {
      section: SECTION.issueActions,
      keys: DIGITS.slice(0, 5).map((digit) => `opt+cmd+${digit}` as const),
      description: () => t('hotkeyProfiles.setStatusNumber'),
      target: { action: 'setStatus', indexed: true },
    },
    {
      section: SECTION.issueActions,
      keys: ['c'],
      description: () => t('hotkeyProfiles.newTask'),
      target: { action: 'createTask' },
      replaces: () => t('hotkeyProfiles.replacedCreateMenu'),
    },
    {
      section: SECTION.issueActions,
      keys: ['e'],
      description: () => t('hotkeyProfiles.editTask'),
      // An open task focuses its editor; in the list, opens the focused task.
      target: {
        tokens: [TOKENS.block.focus, TOKENS.entity.open],
      },
    },
    {
      section: SECTION.issueActions,
      keys: ['a'],
      description: () => t('hotkeyProfiles.assign'),
      target: { tokens: [TOKENS.entity.action.assignee] },
    },
    {
      section: SECTION.issueActions,
      keys: ['i'],
      description: () => t('hotkeyProfiles.assignToMe'),
      target: { action: 'assignToMe' },
    },
    {
      section: SECTION.issueActions,
      keys: ['l', 'shift+l'],
      description: () => t('hotkeyProfiles.changeTags'),
      target: { tokens: [TOKENS.entity.action.tags] },
      replaces: () => t('hotkeyProfiles.replacedExpandItem'),
    },
    {
      section: SECTION.issueActions,
      keys: ['s'],
      description: () => t('hotkeyProfiles.changeStatus'),
      target: { tokens: [TOKENS.entity.action.status] },
      replaces: () => t('hotkeyProfiles.replacedSort'),
    },
    {
      section: SECTION.issueActions,
      keys: ['p'],
      description: () => t('hotkeyProfiles.changePriority'),
      target: { tokens: [TOKENS.entity.action.priority] },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+e'],
      description: () => t('hotkeyProfiles.setStoryPoints'),
      target: { action: 'setStoryPoints' },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+d'],
      description: () => t('hotkeyProfiles.setDueDate'),
      target: { action: 'setDueDate' },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+cmd+d'],
      description: () => t('hotkeyProfiles.removeDueDate'),
      target: { action: 'clearDueDate' },
    },
    {
      section: SECTION.issueActions,
      keys: ['cmd+backspace'],
      description: () => t('hotkeyProfiles.deleteTask'),
      target: { tokens: [TOKENS.entity.action.delete] },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+s'],
      description: () => t('hotkeyProfiles.toggleMute'),
      target: { tokens: [TOKENS.entity.action.mute] },
    },
    {
      section: SECTION.issueActions,
      keys: [['m', 'b']],
      description: () => t('hotkeyProfiles.setDependsOn'),
      target: { action: 'setDependsOn' },
      replaces: () => t('hotkeyProfiles.replacedMoveToFolder'),
    },
    {
      section: SECTION.issueActions,
      keys: ['opt+shift+f'],
      description: () => t('hotkeyProfiles.clearFilters'),
      target: { action: 'clearFilters' },
    },
    {
      section: SECTION.issueActions,
      keys: ['cmd+.'],
      description: () => t('hotkeyProfiles.copyTaskId'),
      target: {
        tokens: [TOKENS.entity.action.copyEntityId],
      },
      replaces: () => t('hotkeyProfiles.replacedWorkspaceNavigation'),
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+cmd+.'],
      description: () => t('hotkeyProfiles.copyBranchName'),
      target: {
        tokens: [TOKENS.entity.action.copyBranchName],
      },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+cmd+,'],
      description: () => t('hotkeyProfiles.copyLink'),
      target: { tokens: [TOKENS.entity.action.copyLink] },
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+cmd+o'],
      description: () => t('hotkeyProfiles.createSubtask'),
      target: { action: 'createSubtask' },
      replaces: () => t('hotkeyProfiles.replacedEditProperties'),
    },
    {
      section: SECTION.issueActions,
      keys: ['shift+p'],
      description: () => t('hotkeyProfiles.addToProject'),
      target: {
        tokens: [TOKENS.entity.action.addToProject],
      },
    },
  ],
  sameKeys: [
    {
      section: SECTION.general,
      keys: ['cmd+k'],
      description: () => t('hotkeyProfiles.openCommandMenu'),
    },
    {
      section: SECTION.general,
      keys: ['cmd+enter'],
      description: () => t('hotkeyProfiles.saveOrSubmit'),
    },
    {
      section: SECTION.general,
      keys: ['enter'],
      description: () => t('hotkeyProfiles.openTask'),
    },
    {
      section: SECTION.general,
      keys: ['x'],
      description: () => t('hotkeyProfiles.selectTask'),
    },
    {
      section: SECTION.general,
      keys: ['k', 'arrowup'],
      description: () => t('hotkeyProfiles.moveUp'),
    },
    {
      section: SECTION.general,
      keys: ['j', 'arrowdown'],
      description: () => t('hotkeyProfiles.moveDown'),
    },
    {
      section: SECTION.navigation,
      keys: ['shift+/'],
      description: () => t('hotkeyProfiles.showShortcuts'),
    },
    {
      section: SECTION.navigation,
      keys: [['g', 'i']],
      description: () => t('hotkeyProfiles.goToHome'),
    },
    {
      section: SECTION.issueActions,
      keys: ['r'],
      description: () => t('hotkeyProfiles.rename'),
    },
    {
      section: SECTION.issueActions,
      keys: ['f'],
      description: () => t('hotkeyProfiles.filterTasks'),
    },
  ],
  sections: [SECTION.general, SECTION.navigation, SECTION.issueActions],
} as const satisfies HotkeyProfile<LinearAction>;

export const HOTKEY_PROFILES = [SUPERHUMAN, LINEAR] as const;

export type HotkeyProfileId = (typeof HOTKEY_PROFILES)[number]['id'];
