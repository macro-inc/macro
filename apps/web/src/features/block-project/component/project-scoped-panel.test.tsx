import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectScopedPanel } from './project-scoped-panel';

afterEach(cleanup);

const homeContent: SplitContent = { type: 'component', id: 'home' };

function hostPanel(isInlinePreview: boolean) {
  const goBack = vi.fn();
  return {
    goBack,
    panel: {
      isInlinePreview,
      handle: { content: () => homeContent, goBack },
    } as unknown as SplitPanelContextType,
  };
}

function scopedPanelIn(host: SplitPanelContextType) {
  let scoped: SplitPanelContextType | undefined;
  render(() => (
    <SplitPanelContext.Provider value={host}>
      {(() => {
        scoped = useProjectScopedPanel('project-1');
        return null;
      })()}
    </SplitPanelContext.Provider>
  ));
  if (!scoped) throw new Error('hook did not run');
  return scoped;
}

it('scopes an inline preview to the project instead of the host view', () => {
  const host = hostPanel(true);
  const scoped = scopedPanelIn(host.panel);

  expect(scoped.handle.content()).toEqual({ type: 'project', id: 'project-1' });
  expect(scoped.isInlinePreview).toBe(true);
  scoped.handle.goBack();
  expect(host.goBack).toHaveBeenCalledOnce();
});

it('keeps the panel of a project opened in its own split', () => {
  const host = hostPanel(false);

  expect(scopedPanelIn(host.panel)).toBe(host.panel);
});
