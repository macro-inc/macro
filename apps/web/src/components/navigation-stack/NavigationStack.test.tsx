import { cleanup, render, screen } from '@solidjs/testing-library';
import { onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NavigationStack,
  type NavigationStackEntry,
  type NavigationStackState,
  useNavigationStack,
} from './NavigationStack';

afterEach(cleanup);

describe('NavigationStack', () => {
  it('unmounts the inactive entry when the path advances', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    let state: NavigationStackState<string> | undefined;

    function CaptureState() {
      state = useNavigationStack<string>();
      return null;
    }

    function Content(props: { name: string }) {
      onMount(() => mounted(props.name));
      onCleanup(() => unmounted(props.name));
      return <span>{props.name}</span>;
    }

    render(() => (
      <NavigationStack.Root defaultValue={['Task']}>
        <CaptureState />
        <NavigationStack.Outlet<string>>
          {(entry) => <Content name={entry.data} />}
        </NavigationStack.Outlet>
      </NavigationStack.Root>
    ));

    expect(screen.getByText('Task')).not.toBeNull();
    expect(state?.navigate('Document')).toBe(true);

    expect(screen.queryByText('Task')).toBeNull();
    expect(screen.getByText('Document')).not.toBeNull();
    expect(mounted).toHaveBeenCalledWith('Document');
    expect(unmounted).toHaveBeenCalledWith('Task');
  });

  it('truncates the path to a selected ancestor', () => {
    let state: NavigationStackState<string> | undefined;

    function CaptureState() {
      state = useNavigationStack<string>();
      return null;
    }

    render(() => (
      <NavigationStack.Root>
        <CaptureState />
      </NavigationStack.Root>
    ));

    const first = state?.push('Task');
    state?.push('Document');
    state?.push('Channel');
    if (!first) throw new Error('Navigation stack state was not captured');

    state?.popTo(first.value);

    expect(state?.entries.map(({ data }) => data)).toEqual(['Task']);
    expect(state?.active()?.data).toBe('Task');
  });

  it('notifies with a distinct path snapshot after each change', () => {
    let state: NavigationStackState<string> | undefined;
    const snapshots: Array<readonly NavigationStackEntry<string>[]> = [];

    function CaptureState() {
      state = useNavigationStack<string>();
      return null;
    }

    render(() => (
      <NavigationStack.Root<string>
        onChange={(entries) => {
          snapshots.push(entries);
        }}
      >
        <CaptureState />
      </NavigationStack.Root>
    ));

    state?.push('Task');
    state?.push('Document');

    expect(snapshots[0]).not.toBe(snapshots[1]);
    expect(snapshots[0]?.map(({ data }) => data)).toEqual(['Task']);
    expect(snapshots[1]?.map(({ data }) => data)).toEqual(['Task', 'Document']);
  });

  it('reconciles external state without notifying', () => {
    let state: NavigationStackState<string> | undefined;
    const onChange = vi.fn();

    function CaptureState() {
      state = useNavigationStack<string>();

      return null;
    }

    render(() => (
      <NavigationStack.Root<string> onChange={onChange}>
        <CaptureState />
      </NavigationStack.Root>
    ));

    state?.reconcile('Document');

    expect(state?.entries.map(({ data }) => data)).toEqual(['Document']);
    expect(onChange).not.toHaveBeenCalled();

    state?.reconcile();

    expect(state?.entries).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('only handles navigation accepted by the root', () => {
    let state: NavigationStackState<string, { blocked?: boolean }> | undefined;

    function CaptureState() {
      state = useNavigationStack<string, { blocked?: boolean }>();
      return null;
    }

    render(() => (
      <NavigationStack.Root<string, { blocked?: boolean }>
        shouldNavigate={(_, options) => options?.blocked !== true}
      >
        <CaptureState />
      </NavigationStack.Root>
    ));

    expect(state?.navigate('Blocked', { blocked: true })).toBe(false);
    expect(state?.navigate('Handled')).toBe(true);
    expect(state?.entries.map(({ data }) => data)).toEqual(['Handled']);
  });
});
