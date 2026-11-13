import { isRecord } from '@app/lib/split-router';
import type { Accessor } from 'solid-js';
import type { SplitContent, SplitHandle, SplitId } from '../layoutManager';
import type { MobilePaneStack } from './createMobilePaneStack';

type BackHandle = Pick<
  SplitHandle,
  'content' | 'previousContent' | 'canGoBack' | 'goBack'
>;

function projectSection(content: SplitContent | null) {
  const metadata = content?.entryMetadata;
  if (!isRecord(metadata) || !isRecord(metadata.route)) return;
  const matches = metadata.route.matches;
  if (!Array.isArray(matches)) return;
  const leaf: unknown = matches.at(-1);
  if (!isRecord(leaf) || leaf.id !== 'tasks-project' || !isRecord(leaf.params))
    return;
  const { projectId, section } = leaf.params;
  if (typeof projectId !== 'string' || !projectId) return;
  if (section !== 'overview' && section !== 'tasks') return;
  return { projectId, section };
}

/** Route Back within a project before falling back to closing its native pane. */
export function createMobileBackNavigation(options: {
  stack: MobilePaneStack;
  phone: Accessor<boolean>;
  getSplit(id: SplitId): BackHandle | undefined;
}) {
  const projectBack = () => {
    if (!options.phone()) return;
    const id = options.stack.front();
    if (!id) return;
    const handle = options.getSplit(id);
    if (!handle?.canGoBack()) return;
    const current = projectSection(handle.content());
    const previous = projectSection(handle.previousContent());
    // Only the explicit Tasks push owns an in-pane Back step. Other native
    // destinations, nested tasks, and entries without Overview keep pane-stack Back.
    if (
      current?.section === 'tasks' &&
      previous?.section === 'overview' &&
      current.projectId === previous.projectId
    )
      return handle;
  };

  return {
    canGoBackInPane: () => Boolean(projectBack()),
    canGoBack(id = options.stack.front()) {
      if (id !== options.stack.front()) return false;
      return Boolean(projectBack()) || options.stack.canGoBack();
    },
    goBack(id = options.stack.front()) {
      if (id !== options.stack.front()) return;
      const handle = projectBack();
      if (handle) handle.goBack();
      else options.stack.goBack();
    },
  };
}
