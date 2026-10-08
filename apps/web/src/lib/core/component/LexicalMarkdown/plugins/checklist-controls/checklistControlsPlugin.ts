/**
 * @file Gives top-level check lists containing tasks a tasks-view-style control line:
 * filters that dim excluded items, grouping with collapsible
 * thin-line group headers, and a progress readout. The view settings persist
 * on the list node itself (see TaskListNode) so they travel with the document.
 *
 * The TaskListNode carries two non-lexical mount elements inside its `<ul>`;
 * this plugin tracks them (and the collected metadata) in stores, and the
 * TaskListControlsRenderer portals the actual UI into the mounts from inside
 * the app tree, keeping query and user context available.
 */
import { ListNode } from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import {
  $setTaskListViewSettings,
  TASK_LIST_BAR_CLASS,
  TaskListNode,
  type TaskListViewSettings,
} from '@macro-inc/lexical-core';
import { $getNodeByKey, type LexicalEditor, type NodeKey } from 'lexical';
import { type Accessor, createSignal } from 'solid-js';
import { createStore, reconcile, type Store } from 'solid-js/store';
import { registerMutationListener } from '../shared/utils';
import { $collectChecklistMeta } from './collect';
import type { ChecklistMeta } from './model';

export type ChecklistMountEntry = {
  listKey: NodeKey;
  bar: HTMLElement;
};

export type ChecklistControlsData = {
  meta: Store<Record<NodeKey, ChecklistMeta>>;
  mounts: Store<Record<NodeKey, ChecklistMountEntry>>;
  /** Bumped after every committed update so DOM-reading effects re-run. */
  domVersion: Accessor<number>;
};

/** Persist a list's view settings onto its node (undoable, collab-synced). */
export function setTaskListSettings(
  editor: LexicalEditor,
  listKey: NodeKey,
  settings: TaskListViewSettings
) {
  // Deep-clone through JSON so no solid store proxies (whose symbol-keyed
  // internals break the Loro sync serializer) end up in node state.
  const plain = JSON.parse(JSON.stringify(settings)) as TaskListViewSettings;
  editor.update(() => {
    const node = $getNodeByKey(listKey);
    if (node) $setTaskListViewSettings(node, plain);
  });
}

export function createChecklistControls() {
  const [meta, setMeta] = createStore<Record<NodeKey, ChecklistMeta>>({});
  const [mounts, setMounts] = createStore<Record<NodeKey, ChecklistMountEntry>>(
    {}
  );
  const [domVersion, setDomVersion] = createSignal(0);

  const data: ChecklistControlsData = { meta, mounts, domVersion };

  const plugin = (editor: LexicalEditor) => {
    const syncMounts = (key: NodeKey) => {
      const element = editor.getElementByKey(key);
      const bar = element?.querySelector<HTMLElement>(
        `:scope > .${TASK_LIST_BAR_CLASS}`
      );
      const existing = mounts[key];
      if (!bar) {
        if (existing) setMounts(key, undefined!);
        return;
      }
      // Only replace the entry when the element actually changed, so portals
      // are not remounted on every list mutation.
      if (existing?.bar === bar) return;
      setMounts(key, { listKey: key, bar });
    };

    const recollect = () => {
      setMeta(
        reconcile(editor.getEditorState().read($collectChecklistMeta), {
          key: 'listKey',
        })
      );
      setDomVersion((v) => v + 1);
    };
    recollect();

    return mergeRegister(
      editor.registerMutationListener(
        ListNode,
        (mutations) => {
          for (const [key, mutation] of mutations) {
            if (mutation === 'destroyed') setMounts(key, undefined!);
            else syncMounts(key);
          }
        },
        { skipInitialization: false }
      ),
      // JSON import ($parseSerializedNode) bypasses node replacement, so
      // lists arriving from collab peers are plain ListNodes; upgrade them.
      editor.registerNodeTransform(ListNode, (node) => {
        if (node instanceof TaskListNode) return;
        const replacement = new TaskListNode(
          node.getListType(),
          node.getStart()
        );
        replacement.updateFromJSON(node.exportJSON());
        node.replace(replacement, true);
      }),
      registerMutationListener(editor, recollect)
    );
  };

  return { data, plugin };
}
