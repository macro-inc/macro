import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { SplitPanel } from '@components/app/split-panel';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewShell, ViewShell, ViewSidebarToggle } from './ViewShell';
import { ViewSidebar } from './ViewSidebar';

const measurement = vi.hoisted(() => ({ width: (): number => 1200 }));

vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({
    get width() {
      return measurement.width();
    },
    height: 800,
  }),
}));

vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/utils/press')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => (
    <button
      aria-label={props.label}
      aria-expanded={props['aria-expanded']}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
    >
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  measurement.width = () => 1000;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps navigation controls inside their own workspaces', () => {
  const collapsed = new Map<string, () => boolean>();
  function Workspace(props: { id: string }) {
    function Controls() {
      collapsed.set(props.id, useViewShell().aside.isCollapsed);
      return (
        <>
          <ViewSidebarToggle action="expand" />
          <ViewSidebarToggle action="collapse" />
        </>
      );
    }
    return (
      <SplitPanelContext.Provider
        value={
          {
            handle: { isFirst: () => true },
            isPanelActive: () => true,
            splitHotkeyScope: props.id,
          } as unknown as SplitPanelContextType
        }
      >
        <ViewShell.Root asidePreferenceKey={props.id} data-testid={props.id}>
          <Controls />
        </ViewShell.Root>
      </SplitPanelContext.Provider>
    );
  }
  const view = render(() => (
    <>
      <Workspace id="home" />
      <Workspace id="mail" />
    </>
  ));
  const home = within(view.getByTestId('home'));
  const mail = within(view.getByTestId('mail'));
  fireEvent.click(home.getByRole('button', { name: 'Hide navigation' }));
  expect(collapsed.get('home')?.()).toBe(true);
  expect(collapsed.get('mail')?.()).toBe(false);
  fireEvent.click(mail.getByRole('button', { name: 'Hide navigation' }));
  expect(collapsed.get('mail')?.()).toBe(true);
  fireEvent.click(home.getByRole('button', { name: 'Show navigation' }));
  expect(collapsed.get('home')?.()).toBe(false);
  expect(collapsed.get('mail')?.()).toBe(true);
});

function setup(preserveDuringResize: boolean, persistWidth = false) {
  const [width, setWidth] = createSignal(1200);
  const [configuredWidth, setConfiguredWidth] = createSignal(256);
  measurement.width = width;
  const onWidthChangeEnd = vi.fn((width: number) => {
    if (persistWidth) setConfiguredWidth(width);
  });
  const view = render(() => (
    <ViewShell.Root
      resizable
      asidePreferenceKey="tasks"
      aside={{ width: configuredWidth(), preserveDuringResize }}
      main={{ preferredWidth: 640 }}
    >
      <ViewShell.Aside onWidthChangeEnd={onWidthChangeEnd}>
        <ViewSidebar.Header>
          <ViewSidebar.Title>Tasks</ViewSidebar.Title>
        </ViewSidebar.Header>
      </ViewShell.Aside>
      <ViewShell.Main>
        <ViewShell.TopBar />
      </ViewShell.Main>
    </ViewShell.Root>
  ));
  const asideWidth = () =>
    Number.parseFloat(
      view.container.querySelector('[data-view-shell-aside]')!.parentElement!
        .style.width
    );
  const growAside = async () => {
    fireEvent.keyDown(view.getByRole('separator'), { key: 'ArrowRight' });
    await Promise.resolve();
  };
  const dragAside = () => {
    fireEvent(
      view.getByRole('separator'),
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 256 })
    );
    fireEvent(window, new MouseEvent('pointermove', { clientX: 296 }));
    fireEvent(window, new MouseEvent('pointerup'));
  };
  return {
    ...view,
    asideWidth,
    growAside,
    dragAside,
    setWidth,
    setConfiguredWidth,
    onWidthChangeEnd,
  };
}

describe('ViewShell aside resize preference', () => {
  it('keeps a pointer resize from the sidebar minimum stable as the split grows', () => {
    const view = setup(false);
    view.setWidth(800);
    expect(view.asideWidth()).toBeCloseTo(224);
    view.dragAside();
    expect(view.asideWidth()).toBeCloseTo(264);
    for (const width of [801, 850, 900, 1200]) {
      view.setWidth(width);
      expect(view.asideWidth()).toBeCloseTo(264);
    }
  });

  it.each([false, true])(
    'keeps a manual resize in a constrained split stable as the split grows (persist=%s)',
    async (persistWidth) => {
      const view = setup(false, persistWidth);
      view.setWidth(890);
      expect(view.asideWidth()).toBeCloseTo(249);
      await view.growAside();
      expect(view.asideWidth()).toBeCloseTo(269);
      for (const width of [891, 900, 1000, 1200]) {
        view.setWidth(width);
        expect(view.asideWidth()).toBeCloseTo(269);
      }
      view.setWidth(880);
      expect(view.asideWidth()).toBeCloseTo(259);
      view.setWidth(1200);
      expect(view.asideWidth()).toBeCloseTo(269);
    }
  );

  it('preserves the chosen width through manual collapse and narrow overlays', async () => {
    const view = setup(false);
    await view.growAside();
    fireEvent.click(view.getByRole('button', { name: 'Hide navigation' }));
    view.setWidth(1100);
    fireEvent.click(view.getByRole('button', { name: 'Show navigation' }));
    expect(view.asideWidth()).toBeCloseTo(276);

    view.setWidth(600);
    fireEvent.click(view.getByRole('button', { name: 'Show navigation' }));
    expect(view.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
    const overlay = view.container.querySelector<HTMLElement>(
      '[data-view-shell-aside]'
    )!;
    expect(Number.parseFloat(overlay.style.width)).toBeCloseTo(276);
    fireEvent.click(
      view.getByRole('button', { name: 'Close navigation backdrop' })
    );
    view.setWidth(1200);
    expect(view.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
    expect(view.asideWidth()).toBeCloseTo(276);
    view.setWidth(1100);
    expect(view.asideWidth()).toBeCloseTo(276);
    expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
  });

  it('remembers the width after a pointer drag', () => {
    const view = setup(true);
    view.dragAside();
    expect(view.asideWidth()).toBeCloseTo(296);
    view.setWidth(1100);
    expect(view.asideWidth()).toBeCloseTo(296);
    expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'keeps the chosen width when the containing split resizes (preserve=%s)',
    async (preserve) => {
      const view = setup(preserve);
      expect(view.asideWidth()).toBeCloseTo(256);
      await view.growAside();
      expect(view.asideWidth()).toBeCloseTo(276);
      expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
      expect(view.onWidthChangeEnd.mock.calls[0][0]).toBeCloseTo(276);
      view.setWidth(1100);
      expect(view.asideWidth()).toBeCloseTo(276);
      view.setWidth(1400);
      expect(view.asideWidth()).toBeCloseTo(276);
      expect(view.onWidthChangeEnd).toHaveBeenCalledOnce();
    }
  );

  it('yields to the main preference, then restores the chosen width', async () => {
    const view = setup(false);
    await view.growAside();
    view.setWidth(890);
    expect(view.asideWidth()).toBeCloseTo(249);
    view.setWidth(1200);
    expect(view.asideWidth()).toBeCloseTo(276);
    view.setWidth(700);
    view.setWidth(1200);
    expect(view.asideWidth()).toBeCloseTo(276);
  });

  it('honors a new configured width after a manual resize', async () => {
    const view = setup(true);
    await view.growAside();
    view.setConfiguredWidth(300);
    expect(view.asideWidth()).toBeCloseTo(300);
    view.setWidth(1100);
    expect(view.asideWidth()).toBeCloseTo(300);
  });
});

function Workspace(props: {
  app: string;
  asideRequired?: boolean;
  asidePinned?: boolean;
  mounted?: () => void;
}) {
  function Content() {
    onMount(() => props.mounted?.());
    return <input aria-label={`${props.app} draft`} />;
  }
  return (
    <section aria-label={props.app}>
      <ViewShell.Root
        asidePreferenceKey={props.app}
        asideRequired={props.asideRequired}
        asidePinned={props.asidePinned}
      >
        <ViewShell.Aside>
          <ViewSidebar.Header>
            <ViewSidebar.CloseButton />
            <ViewSidebar.Title>{props.app}</ViewSidebar.Title>
          </ViewSidebar.Header>
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.TopBar>
            <h1>Selected item</h1>
          </ViewShell.TopBar>
          <Content />
        </ViewShell.Main>
      </ViewShell.Root>
    </section>
  );
}

it.each([720, 600, 400])(
  'keeps split close available in a %spx navigation overlay',
  (width) => {
    measurement.width = () => width;
    const [canClose, setCanClose] = createSignal(true);
    const panes = ['home', 'tasks', 'email'].map((app) => ({
      app,
      close: vi.fn(),
    }));
    render(() =>
      panes.map((pane) => (
        <SplitPanel.Root
          controller={{
            canClose,
            close: pane.close,
            canGoBack: () => false,
            goBack: vi.fn(),
            canGoForward: () => false,
            goForward: vi.fn(),
          }}
        >
          <Workspace app={pane.app} />
        </SplitPanel.Root>
      ))
    );

    for (const pane of panes) {
      const workspace = within(screen.getByRole('region', { name: pane.app }));
      fireEvent.click(
        workspace.getByRole('button', { name: 'Show navigation' })
      );
      expect(workspace.getByRole('button', { name: 'Close' })).toBeTruthy();
    }

    const email = within(screen.getByRole('region', { name: 'email' }));
    fireEvent.click(email.getByRole('button', { name: 'Close' }));
    expect(panes[2].close).toHaveBeenCalledOnce();
    expect(panes[0].close).not.toHaveBeenCalled();
    expect(panes[1].close).not.toHaveBeenCalled();

    setCanClose(false);
    expect(email.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(email.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  }
);

it('hides only the owning split and keeps the current item mounted', () => {
  const mounted = vi.fn();
  render(() => (
    <>
      <Workspace app="email" mounted={mounted} />
      <Workspace app="tasks" />
    </>
  ));
  const email = within(screen.getByRole('region', { name: 'email' }));
  const tasks = within(screen.getByRole('region', { name: 'tasks' }));
  fireEvent.input(email.getByRole('textbox'), {
    target: { value: 'Unsent draft' },
  });
  fireEvent.click(email.getByRole('button', { name: 'Hide navigation' }));
  expect(email.queryByRole('button', { name: 'Hide navigation' })).toBeNull();
  expect(tasks.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  fireEvent.click(email.getByRole('button', { name: 'Show navigation' }));
  expect((email.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Unsent draft'
  );
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('restores visibility per app after remount and persists reopening', () => {
  const first = render(() => <Workspace app="email" />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  first.unmount();
  const second = render(() => (
    <>
      <Workspace app="email" />
      <Workspace app="calendar" />
    </>
  ));
  expect(
    within(screen.getByRole('region', { name: 'calendar' })).getByRole(
      'button',
      { name: 'Hide navigation' }
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  second.unmount();
  render(() => <Workspace app="email" />);
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
});

it('opens secondary splits without navigation and leaves the preference alone', () => {
  function InSplit(props: { app: string; first: boolean }) {
    return (
      <SplitPanelContext.Provider
        value={
          {
            handle: { isFirst: () => props.first },
            isPanelActive: () => false,
            splitHotkeyScope: props.app,
          } as unknown as SplitPanelContextType
        }
      >
        <Workspace app={props.app} />
      </SplitPanelContext.Provider>
    );
  }
  const split = render(() => <InSplit app="email" first={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  split.unmount();
  const reopened = render(() => <InSplit app="email" first={false} />);
  expect(screen.getByRole('button', { name: 'Show navigation' })).toBeTruthy();
  reopened.unmount();
  render(() => <InSplit app="email" first />);
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
});

it('reopens automatic narrow collapse as a dismissible overlay', () => {
  measurement.width = () => 600;
  render(() => <Workspace app="documents" />);
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Hide navigation' }), {
    key: 'Escape',
  });
  expect(screen.getByRole('button', { name: 'Show navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Close navigation backdrop' })
  );
  expect(screen.getByRole('button', { name: 'Show navigation' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Close navigation backdrop' })
  ).toBeNull();
});

it('lets an open popup handle Escape before dismissing the navigation overlay', () => {
  measurement.width = () => 600;
  const [expanded, setExpanded] = createSignal(true);
  render(() => (
    <ViewShell.Root asidePreferenceKey="calendar">
      <ViewShell.Aside>
        <button type="button" aria-haspopup="menu" aria-expanded={expanded()}>
          Booking links
        </button>
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Handled Escape
        </button>
        <Portal>
          <button type="button" role="menuitem">
            Manage booking links
          </button>
        </Portal>
      </ViewShell.Aside>
      <ViewShell.Main>
        <ViewShell.TopBar />
      </ViewShell.Main>
    </ViewShell.Root>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  const popupTrigger = screen.getByRole('button', { name: 'Booking links' });
  for (const target of [
    screen.getByRole('menuitem', { name: 'Manage booking links' }),
    popupTrigger,
    screen.getByRole('button', { name: 'Handled Escape' }),
  ]) {
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'Close navigation backdrop' })
    ).toBeTruthy();
  }
  setExpanded(false);
  fireEvent.keyDown(popupTrigger, { key: 'Escape' });
  expect(
    screen.queryByRole('button', { name: 'Close navigation backdrop' })
  ).toBeNull();
});

const asideDocked = () =>
  !document
    .querySelector('[data-view-shell-aside]')!
    .parentElement!.classList.contains('hidden');

describe('pinned navigation', () => {
  it('docks wide navigation without a collapse control, even when saved hidden', () => {
    const unpinned = render(() => <Workspace app="settings" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    expect(asideDocked()).toBe(false);
    unpinned.unmount();

    render(() => <Workspace app="settings" asidePinned />);
    expect(asideDocked()).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Hide navigation' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Show navigation' })
    ).toBeNull();
  });

  it('collapses only into the narrow overlay, which starts closed', () => {
    const [width, setWidth] = createSignal(1000);
    measurement.width = width;
    render(() => <Workspace app="settings" asidePinned />);

    setWidth(600);
    expect(
      screen.queryByRole('button', { name: 'Close navigation backdrop' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    expect(
      screen.queryByRole('button', { name: 'Close navigation backdrop' })
    ).toBeNull();

    setWidth(1000);
    expect(asideDocked()).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Hide navigation' })
    ).toBeNull();
  });
});

describe('required navigation', () => {
  it('docks a hidden wide sidebar without a collapse control until a selection returns', () => {
    const [required, setRequired] = createSignal(false);
    render(() => <Workspace app="channels" asideRequired={required()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    expect(asideDocked()).toBe(false);
    const savePreference = vi.spyOn(localStorage, 'setItem');

    setRequired(true);
    expect(asideDocked()).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Hide navigation' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Show navigation' })
    ).toBeNull();

    setRequired(false);
    expect(asideDocked()).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Show navigation' })
    ).toBeTruthy();
    expect(savePreference).not.toHaveBeenCalled();
  });

  it('animates the pin like a manual toggle', async () => {
    const originalAnimate = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'animate'
    );
    const animate = vi.fn<HTMLElement['animate']>(
      () => ({ cancel: vi.fn() }) as unknown as Animation
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    try {
      const [required, setRequired] = createSignal(false);
      render(() => <Workspace app="channels" asideRequired={required()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
      await Promise.resolve();
      expect(animate).toHaveBeenCalled();
      const panelsAnimated = () =>
        new Set(animate.mock.contexts as HTMLElement[]);

      animate.mockClear();
      setRequired(true);
      await Promise.resolve();
      expect(
        panelsAnimated().has(
          document.querySelector('[data-view-shell-aside]')!.parentElement!
        )
      ).toBe(true);

      animate.mockClear();
      setRequired(false);
      await Promise.resolve();
      expect(animate).toHaveBeenCalled();
    } finally {
      if (originalAnimate) {
        Object.defineProperty(
          HTMLElement.prototype,
          'animate',
          originalAnimate
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      }
    }
  });

  it('ignores a programmatic collapse while pinned', () => {
    const [required, setRequired] = createSignal(true);
    function Pinned() {
      const shell = useViewShell();
      return (
        <button type="button" onClick={shell.aside.collapse}>
          Collapse programmatically
        </button>
      );
    }
    render(() => (
      <ViewShell.Root asidePreferenceKey="channels" asideRequired={required()}>
        <ViewShell.Aside>
          <ViewSidebar.Header>
            <ViewSidebar.Title>channels</ViewSidebar.Title>
          </ViewSidebar.Header>
          <Pinned />
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.TopBar />
        </ViewShell.Main>
      </ViewShell.Root>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse programmatically' })
    );
    expect(asideDocked()).toBe(true);

    setRequired(false);
    expect(asideDocked()).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Hide navigation' })
    ).toBeTruthy();
  });

  it('opens the narrow overlay and closes it again once something is selected', () => {
    const [width, setWidth] = createSignal(1000);
    const [required, setRequired] = createSignal(true);
    measurement.width = width;
    render(() => <Workspace app="channels" asideRequired={required()} />);

    setWidth(600);
    expect(
      screen.getByRole('button', { name: 'Close navigation backdrop' })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close navigation backdrop' })
    );
    expect(
      screen.queryByRole('button', { name: 'Close navigation backdrop' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Show navigation' })
    ).toBeTruthy();

    setRequired(false);
    setRequired(true);
    expect(
      screen.getByRole('button', { name: 'Close navigation backdrop' })
    ).toBeTruthy();
    setRequired(false);
    expect(
      screen.queryByRole('button', { name: 'Close navigation backdrop' })
    ).toBeNull();

    setWidth(1000);
    expect(
      screen.getByRole('button', { name: 'Hide navigation' })
    ).toBeTruthy();
  });
});

describe.each(['home', 'channels', 'tasks', 'email'])(
  '%s responsive sidebar',
  (app) => {
    it('restores automatic collapse but preserves an explicit desktop collapse', () => {
      const [width, setWidth] = createSignal(1000);
      measurement.width = width;
      render(() => <Workspace app={app} />);

      setWidth(600);
      expect(
        screen.getByRole('button', { name: 'Show navigation' })
      ).toBeTruthy();
      setWidth(1000);
      expect(
        screen.getByRole('button', { name: 'Hide navigation' })
      ).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
      setWidth(600);
      setWidth(1000);
      expect(
        screen.getByRole('button', { name: 'Show navigation' })
      ).toBeTruthy();
    });

    it.each(['open', 'escape', 'backdrop', 'toggle'] as const)(
      'restores navigation after using a narrow overlay (%s)',
      (dismissal) => {
        const [width, setWidth] = createSignal(1000);
        measurement.width = width;
        const view = render(() => <Workspace app={app} />);

        setWidth(600);
        fireEvent.click(
          screen.getByRole('button', { name: 'Show navigation' })
        );
        if (dismissal === 'escape') {
          fireEvent.keyDown(
            screen.getByRole('button', { name: 'Hide navigation' }),
            {
              key: 'Escape',
            }
          );
        } else if (dismissal !== 'open') {
          fireEvent.click(
            screen.getByRole('button', {
              name:
                dismissal === 'backdrop'
                  ? 'Close navigation backdrop'
                  : 'Hide navigation',
            })
          );
        }
        if (dismissal !== 'open') {
          expect(
            screen.getByRole('button', { name: 'Show navigation' })
          ).toBeTruthy();
        }

        setWidth(1000);
        expect(
          screen.getByRole('button', { name: 'Hide navigation' })
        ).toBeTruthy();
        expect(
          screen.queryByRole('button', { name: 'Close navigation backdrop' })
        ).toBeNull();
        setWidth(600);
        expect(
          screen.queryByRole('button', { name: 'Hide navigation' })
        ).toBeNull();
        setWidth(1000);
        view.unmount();
        render(() => <Workspace app={app} />);
        expect(
          screen.getByRole('button', { name: 'Hide navigation' })
        ).toBeTruthy();
      }
    );

    it.each([false, true])(
      'preserves a hidden wide sidebar after using a narrow overlay (dismiss=%s)',
      (dismiss) => {
        const [width, setWidth] = createSignal(1000);
        measurement.width = width;
        const view = render(() => <Workspace app={app} />);
        fireEvent.click(
          screen.getByRole('button', { name: 'Hide navigation' })
        );
        const savePreference = vi.spyOn(localStorage, 'setItem');

        setWidth(600);
        fireEvent.click(
          screen.getByRole('button', { name: 'Show navigation' })
        );
        expect(
          screen.getByRole('button', { name: 'Hide navigation' })
        ).toBeTruthy();
        if (dismiss) {
          fireEvent.click(
            screen.getByRole('button', { name: 'Hide navigation' })
          );
        }
        expect(savePreference).not.toHaveBeenCalled();

        setWidth(1000);
        expect(
          screen.queryByRole('button', { name: 'Hide navigation' })
        ).toBeNull();
        expect(
          screen.getByRole('button', { name: 'Show navigation' })
        ).toBeTruthy();
        view.unmount();
        render(() => <Workspace app={app} />);
        expect(
          screen.getByRole('button', { name: 'Show navigation' })
        ).toBeTruthy();
      }
    );
  }
);
