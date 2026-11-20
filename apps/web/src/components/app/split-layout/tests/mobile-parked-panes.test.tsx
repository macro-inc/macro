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
  const { usePaneHidden } = await import('@core/context/pane-visibility');

  return {
    SplitPanel: (props: { split: { id: string } }) => {
      const id = props.split.id;
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
      const hidden = usePaneHidden();
      useAndroidBackNavigation(() => {
        backs.push(id);
        return true;
      });
      onCleanup(() => mounts.set(id, (mounts.get(id) ?? 0) - 100));
      return (
        <p data-view={id} data-hidden={String(hidden())}>
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

function mountContainer() {
  let forward: ((from: SplitId) => void) | undefined;
  // What the stack shows, which follows the router's open panes.
  const [open, setOpen] = createSignal<readonly SplitId[]>([id('mail')]);
  const [routerOpen, setRouterOpen] = createSignal<readonly PaneId[]>([
    'mail' as PaneId,
  ]);
  const [parked, setParked] = createSignal<readonly PaneId[]>([]);
  const stack: MobilePaneStack = {
    front: () => open().at(-1),
    behind: () => open().at(-2),
    canGoBack: () => open().length > 1,
    completeGoBack: () => {},
    setAnimatedTrigger: () => {},
    setForwardTrigger: (trigger) => {
      forward = trigger;
    },
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
      openPanes={routerOpen}
      panelRefs={new Map<SplitId, HTMLDivElement>()}
    />
  ));

  /**
   * The dock switch: `next` comes to the front, the open view parks. The
   * router changes its open and parked panes in one batch; with
   * `stackLags`, the stack follows only afterwards.
   */
  const switchTo = (next: string, stackLags = false) => {
    const leaving = open().map((split) => split as string as PaneId);
    batch(() => {
      setParked((current) => [
        ...current.filter((pane) => pane !== next),
        ...leaving,
      ]);
      setRouterOpen([next as PaneId]);
      if (!stackLags) setOpen([id(next)]);
    });
    if (stackLags) setOpen([id(next)]);
  };

  /** The stack's push animation, sliding a pane in over `from`. */
  const slideOver = (from: string) => forward?.(id(from));

  return { ...result, switchTo, slideOver };
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

  it('keeps a view mounted when the router shows it before the stack does', () => {
    const { switchTo } = mountContainer();
    switchTo('channels');
    const before = mounts.get('mail');

    switchTo('mail', true);
    expect(mounts.get('mail')).toBe(before);
  });

  it('presents the new view when the one a slide was covering parks', () => {
    const { container, switchTo, slideOver } = mountContainer();
    slideOver('mail');

    switchTo('channels');
    expect(wrapperOf(container, 'channels').inert).toBe(false);
    expect(wrapperOf(container, 'mail').inert).toBe(true);
  });

  it('leaves Android Back to the shown view, not a parked one', () => {
    const { switchTo } = mountContainer();
    switchTo('channels');

    window.dispatchEvent(
      new Event('android-navigate-back', { cancelable: true })
    );
    expect(backs).toEqual(['channels']);
  });

  it('tells a view it is hidden while parked', () => {
    const { container, switchTo } = mountContainer();
    const mail = () => container.querySelector('[data-view="mail"]');
    expect(mail()?.getAttribute('data-hidden')).toBe('false');

    switchTo('channels');
    expect(mail()?.getAttribute('data-hidden')).toBe('true');
    switchTo('mail');
    expect(mail()?.getAttribute('data-hidden')).toBe('false');
  });
});
