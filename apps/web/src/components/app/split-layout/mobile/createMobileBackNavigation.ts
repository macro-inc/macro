import type { Accessor } from 'solid-js';
import type { SplitHandle, SplitId } from '../layoutManager';
import { projectLocation, runProjectBack } from '../project-back-navigation';
import type { MobilePaneStack } from './createMobilePaneStack';

type BackHandle = Pick<SplitHandle, 'content' | 'goBackTo' | 'replace'>;

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
    if (!handle) return;
    const location = projectLocation(handle.content());
    if (location && location.kind !== 'list') return handle;
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
      if (!handle) {
        options.stack.goBack();
        return;
      }
      runProjectBack(handle);
    },
  };
}
