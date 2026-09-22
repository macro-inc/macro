import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { readDiffUrlState } from '../core/url-state';
import { createMemoryStorage } from '../tests/memory-storage';
import { createUrlDiffState } from '../url-diff-state';
import { createPaneLayout } from './create-pane-layout';

function setup(url: string) {
  const history = createMemoryHistory();
  history.set({ value: url, replace: true });
  const [sessionId, setSessionId] = createSignal('s1');
  let state!: ReturnType<typeof createUrlDiffState>;
  let layout!: ReturnType<typeof createPaneLayout>;
  const mounted = render(() => (
    <MemoryRouter history={history}>
      <Route
        path="/session"
        component={() => {
          state = createUrlDiffState(sessionId);
          layout = createPaneLayout({
            sessionId,
            storage: createMemoryStorage(),
            layout: [state.layout, state.setLayout],
          });
          return (
            <div>
              {layout.layout()}:{state.diffStyle()}
            </div>
          );
        }}
      />
    </MemoryRouter>
  ));
  return {
    ...mounted,
    history,
    state: () => state,
    layout: () => layout,
    setSessionId,
  };
}

describe('URL diff state', () => {
  it('restores a shared view and follows browser history for open, spotlight, style, and close', async () => {
    const { history, state, layout } = setup(
      '/session?keep=1&diff=s1:split:unified#message'
    );
    expect(layout().changesVisible()).toBe(true);
    expect(layout().sessionVisible()).toBe(true);
    state().setDiffStyle('split');
    await waitFor(() => expect(state().diffStyle()).toBe('split'));
    layout().spotlight();
    await waitFor(() => expect(layout().sessionVisible()).toBe(false));
    const shared = new URL(history.get(), 'http://local');
    expect(shared.searchParams.get('keep')).toBe('1');
    expect(shared.hash).toBe('#message');
    expect(readDiffUrlState(shared.searchParams.get('diff'), 's1')).toEqual({
      layout: 'changes-only',
      diffStyle: 'split',
    });
    layout().close();
    await waitFor(() => expect(layout().changesVisible()).toBe(false));
    history.back();
    await waitFor(() => expect(layout().layout()).toBe('changes-only'));
    history.back();
    await waitFor(() => expect(layout().layout()).toBe('split'));
    history.back();
    await waitFor(() => expect(state().diffStyle()).toBe('unified'));
    history.forward();
    await waitFor(() => expect(state().diffStyle()).toBe('split'));
  });

  it('keeps session states separate and a plain URL closed', async () => {
    const { history, state, layout, setSessionId } = setup(
      '/session?diff=s2:changes-only:split'
    );
    expect(layout().changesVisible()).toBe(false);
    layout().open();
    await waitFor(() => expect(layout().layout()).toBe('split'));
    expect(
      readDiffUrlState(
        new URL(history.get(), 'http://local').searchParams.get('diff'),
        's2'
      )
    ).toEqual({ layout: 'changes-only', diffStyle: 'split' });
    layout().close();
    await waitFor(() => expect(layout().changesVisible()).toBe(false));
    expect(
      new URL(history.get(), 'http://local').searchParams.get('diff')
    ).toBe('s2:changes-only:split');
    setSessionId('s2');
    expect(layout().layout()).toBe('changes-only');
    expect(state().diffStyle()).toBe('split');
    setSessionId('s3');
    expect(layout().changesVisible()).toBe(false);
  });

  it('ignores malformed values and does not put divider drags into history', async () => {
    const { history, layout } = setup(
      '/session?diff=s1:invalid:split,s2:split:invalid'
    );
    expect(layout().changesVisible()).toBe(false);
    const before = history.get();
    layout().setChangesShare(65);
    expect(layout().changesShare()).toBe(65);
    expect(history.get()).toBe(before);
    layout().open();
    await waitFor(() => expect(layout().layout()).toBe('split'));
    expect(
      new URL(history.get(), 'http://local').searchParams.get('diff')
    ).toBe('s1:split:unified');
  });
});
