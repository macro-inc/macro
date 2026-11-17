import { render } from '@solidjs/testing-library';
import { batch, createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Parked views must not take Android's Back; the container wires it only there.
vi.mock(import('@core/util/platform'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlatform: (target: Parameters<typeof actual.isPlatform>[0]) =>
      Array.isArray(target) ? target.includes('android') : target === 'android',
  };
});

// A stand-in view: it counts its mounts and, like Email's search, takes Back.
const mounts = new Map<string, number>();
const backs: string[] = [];
vi.mock('../components/SplitPanel', async () => {
  const { useAndroidBackNavigation } = await import('@core/mobile/androidBack');
  const { usePaneSuspended } = await import('@core/context/pane-visibility');

  return {
    SplitPanel: (props: { split: { id: string } }) => {
      const id = props.split.id;
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
      const suspended = usePaneSuspended();
      useAndroidBackNavigation(() => {
        backs.push(id);
        return true;
      });
      onCleanup(() => mounts.set(id, (mounts.get(id) ?? 0) - 100));
      return (
        <p data-view={id} data-suspended={String(suspended())}>
          {id}
        </p>
      );
    },
  };
});

import type { PaneId } from '@app/lib/split-router';
import type { SplitHandle, SplitId, SplitState } from '../layoutManager';
import type { MobilePaneStack } from '../mobile/createMobilePaneStack';
import { MobileSplitContainer } from '../mobile/MobileSplitContainer';

const id = (value: string) => value as SplitId;

function mountContainer(suspends = false) {
  const [open, setOpen] = createSignal<readonly SplitId[]>([id('mail')]);
  const [parked, setParked] = createSignal<readonly PaneId[]>([]);
  const stack: MobilePaneStack = {
    front: () => open().at(-1),
    behind: () => open().at(-2),
    canGoBack: () => open().length > 1,
    completeGoBack: () => {},
    setAnimatedTrigger: () => {},
    setForwardTrigger: () => {},
    goBack: () => {},
  };
  const result = render(() => (
    <MobileSplitContainer
      splitManager={{
        getSplit: (split) => ({ id: split }) as SplitHandle,
        splitState: (split) => ({ id: split }) as SplitState,
      }}
      stack={stack}
      parkedPanes={parked}
      suspendsParked={() => suspends}
      panelRefs={new Map<SplitId, HTMLDivElement>()}
    />
  ));

  /** The dock switch: `next` comes to the front, the open view parks. */
  const switchTo = (next: string) => {
    const leaving = open().map((split) => split as string as PaneId);
    // The router changes open and retained panes in one batch.
    batch(() => {
      setParked((current) => [
        ...current.filter((pane) => pane !== next),
        ...leaving,
      ]);
      setOpen([id(next)]);
    });
  };

  return { ...result, switchTo };
}

const wrapperOf = (container: HTMLElement, view: string) =>
  container.querySelector(`[data-view="${view}"]`)
    ?.parentElement as HTMLElement;

afterEach(() => {
  mounts.clear();
  backs.length = 0;
});

describe('parked panes in the mobile split container', () => {
  it('keeps a parked view mounted, hidden and inert, and shows it again without remounting', () => {
    const { container, switchTo } = mountContainer();

    switchTo('channels');
    const mail = wrapperOf(container, 'mail');
    expect(mail.hasAttribute('data-parked-pane')).toBe(true);
    expect(mail.inert).toBe(true);
    expect(mail.className).toContain('[content-visibility:hidden]');
    expect(wrapperOf(container, 'channels').inert).toBe(false);

    switchTo('mail');
    expect(wrapperOf(container, 'mail').hasAttribute('data-parked-pane')).toBe(
      false
    );
    expect(wrapperOf(container, 'mail').inert).toBe(false);
    expect(mounts.get('mail')).toBe(1);
    expect(mounts.get('channels')).toBe(1);
  });

  it('leaves Android Back to the shown view, not a parked one', () => {
    const { switchTo } = mountContainer();
    switchTo('channels');

    window.dispatchEvent(
      new Event('android-navigate-back', { cancelable: true })
    );
    expect(backs).toEqual(['channels']);
  });

  it('marks parked views suspended only when hidden views are suspended', () => {
    const live = mountContainer(false);
    live.switchTo('channels');
    expect(
      live.container
        .querySelector('[data-view="mail"]')
        ?.getAttribute('data-suspended')
    ).toBe('false');
    live.unmount();

    const suspended = mountContainer(true);
    suspended.switchTo('channels');
    const mail = () => suspended.container.querySelector('[data-view="mail"]');
    expect(mail()?.getAttribute('data-suspended')).toBe('true');
    suspended.switchTo('mail');
    expect(mail()?.getAttribute('data-suspended')).toBe('false');
  });
});
