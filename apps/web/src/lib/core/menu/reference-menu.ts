import { groupMenuItems, type MenuGroup } from './group-menu-items';

export type ReferenceAction =
  | 'open-new-split'
  | 'ask-macro'
  | 'copy-link'
  | 'copy-branch-name'
  | 'convert-preview'
  | 'convert-text'
  | 'convert-mention'
  | 'collapse'
  | 'delete';

const ACTION_GROUPS: Record<ReferenceAction, MenuGroup> = {
  'open-new-split': 'open',
  'ask-macro': 'most-used',
  'copy-link': 'copy',
  'copy-branch-name': 'copy',
  'convert-preview': 'modify',
  'convert-text': 'modify',
  'convert-mention': 'modify',
  collapse: 'state',
  delete: 'delete',
};
type CommonOptions = {
  openInNewSplit: boolean;
  askMacro: boolean;
  copyBranchName: boolean;
  delete: boolean;
};

type Options = CommonOptions &
  (
    | {
        host: 'preview';
        convertPreview: boolean;
        convertToText: boolean;
        collapse: boolean;
      }
    | { host: 'card'; convertToMention: boolean }
  );

/** Keep the two hosts' action sets distinct while sharing semantic order. */
export function referenceMenuGroups(options: Options) {
  const actions: ReferenceAction[] = [];
  if (options.openInNewSplit) actions.push('open-new-split');
  if (options.askMacro) actions.push('ask-macro');
  actions.push('copy-link');
  if (options.copyBranchName) actions.push('copy-branch-name');
  if (options.host === 'preview') {
    if (options.convertPreview) actions.push('convert-preview');
    if (options.convertToText) actions.push('convert-text');
    if (options.collapse) actions.push('collapse');
  } else if (options.convertToMention) {
    actions.push('convert-mention');
  }
  if (options.delete) actions.push('delete');

  return groupMenuItems(actions, (action) => ACTION_GROUPS[action]);
}
