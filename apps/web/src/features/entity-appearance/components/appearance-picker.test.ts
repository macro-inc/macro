import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { Dropdown } from '@ui';
import { ok } from 'neverthrow';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityAppearanceMenu } from '../appearance-menu';
import type { EntityAppearance } from '../core/appearance';
import { createRecentIcons } from '../primitives/create-recent-icons';
import type { AppearanceEditorProps } from '../views/appearance-editor';
import { AppearancePicker } from './appearance-picker';

const menuSave = vi.hoisted(() => vi.fn());
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'picker-test' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('../entity-appearance', () => ({ useChangeEntityIcon: () => vi.fn() }));
vi.mock('../appearance-dialog', async () => {
  const { AppearanceEditorContent } = await import(
    '../views/appearance-editor'
  );
  return {
    AppearanceMenuContent: (
      props: Omit<AppearanceEditorProps, 'open' | 'onOpenChange'> & {
        onClose: () => void;
      }
    ) =>
      createComponent(AppearanceEditorContent, {
        ...props,
        onClose: props.onClose,
        save: menuSave,
      }),
  };
});

type Icon = NonNullable<EntityAppearance['icon']>;
const SCROLL_TO = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollTo'
);
const SCROLL_TOP = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'scrollTop'
);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      private targets = new Set<Element>();
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => {
          if (!this.targets.has(target) || !(target instanceof HTMLElement))
            return;
          const child = target.firstElementChild;
          const height = target.hasAttribute('data-appearance-scroll')
            ? 304
            : child instanceof HTMLElement
              ? Number.parseFloat(child.style.height) || 36
              : 36;
          const size = { inlineSize: 344, blockSize: height };
          this.callback(
            [
              {
                target,
                contentRect: new DOMRect(0, 0, 344, height),
                borderBoxSize: [size],
                contentBoxSize: [size],
                devicePixelContentBoxSize: [size],
              },
            ],
            this
          );
        });
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(
    function (this: HTMLElement, value: number) {
      const previous = this.scrollTop;
      SCROLL_TOP?.set?.call(this, value);
      if (previous !== value)
        queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-appearance-scroll') ? 304 : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-appearance-scroll') ? 344 : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      const content = this.firstElementChild;
      return content instanceof HTMLElement
        ? Number.parseFloat(content.style.height) || 0
        : 0;
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0;
      this.dispatchEvent(new Event('scroll'));
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (SCROLL_TO)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', SCROLL_TO);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

function renderPicker(mobile = false, initialRecent: Icon[] = []) {
  localStorage.setItem(
    'entity-icons:recent:picker-test',
    JSON.stringify(initialRecent)
  );
  const change = vi.fn();
  const close = vi.fn();
  const view = render(() => {
    const [appearance, setAppearance] = createSignal<EntityAppearance>({
      icon: null,
      color: null,
    });
    const recent = createRecentIcons('picker-test');
    return createComponent(AppearancePicker, {
      get appearance() {
        return appearance();
      },
      defaultIcon: 'md',
      onChange(value) {
        change(value);
        setAppearance(value);
      },
      onClose: close,
      get recent() {
        return recent.icons();
      },
      onPick: recent.record,
      saving: false,
      mobile,
    });
  });
  return { change, close, container: view.container };
}

describe('appearance picker interaction', () => {
  it('chooses icons and colors immediately without closing, and Remove retains color', async () => {
    const { change, close } = renderPicker();
    fireEvent.input(screen.getByRole('textbox', { name: 'Search icons' }), {
      target: { value: 'star' },
    });
    fireEvent.click(
      await screen.findByLabelText('Star', { selector: 'button' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(change).toHaveBeenLastCalledWith({
      icon: { kind: 'macro', name: 'star' },
      color: 'blue',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(change).toHaveBeenLastCalledWith({ icon: null, color: 'blue' });
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    ['idea', 'Idea', 'lightbulb'],
    ['dining', 'Dining', 'fork-knife'],
  ])('finds a stored icon by its %s noun', async (search, label, name) => {
    const { change } = renderPicker();
    fireEvent.input(screen.getByRole('textbox', { name: 'Search icons' }), {
      target: { value: search },
    });
    fireEvent.click(
      await screen.findByLabelText(label, { selector: 'button' })
    );
    expect(change).toHaveBeenLastCalledWith({
      icon: { kind: 'macro', name },
      color: null,
    });
  });

  it('searches emoji on Icons and moves keyboard focus into the result', async () => {
    const { change } = renderPicker();
    const search = screen.getByRole('textbox', { name: 'Search icons' });
    fireEvent.input(search, { target: { value: 'rocket' } });
    const rocket = await waitFor(
      () => {
        const emoji = screen
          .getAllByLabelText('Rocket', { selector: 'button' })
          .find((button) => button.textContent?.includes('🚀'));
        expect(emoji).toBeDefined();
        return emoji;
      },
      { timeout: 5000 }
    );
    if (!rocket) throw new Error('Missing emoji search result');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(
        document.activeElement?.getAttribute('data-appearance-option')
      ).toContain('macro')
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(rocket));
    fireEvent.click(rocket);
    expect(change).toHaveBeenLastCalledWith({
      icon: { kind: 'emoji', value: '🚀' },
      color: null,
    });
    fireEvent.keyDown(rocket, { key: 'c' });
    expect(document.activeElement).toBe(search);
    expect(search instanceof HTMLInputElement && search.value).toBe('rocketc');
  });

  it('filters one-character searches instead of showing every emoji', async () => {
    renderPicker();
    const search = screen.getByRole('textbox', { name: 'Search icons' });
    fireEvent.input(search, { target: { value: 'rocket' } });
    await screen.findAllByLabelText('Rocket', { selector: 'button' });
    fireEvent.input(search, { target: { value: '{' } });
    expect(
      screen.queryByLabelText('Rocket', { selector: 'button' })
    ).toBeNull();
  });

  it('virtualizes both catalogs and jumps to unmounted emoji categories', async () => {
    const { container } = renderPicker();
    await screen.findByLabelText('Board', { selector: 'button' });
    expect(
      container.querySelectorAll('[data-appearance-option]').length
    ).toBeLessThan(160);
    expect(
      screen.queryByLabelText('Swatches', { selector: 'button' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
    await screen.findByText('Smileys & people', { selector: 'h3' });
    expect(
      container.querySelectorAll('[data-appearance-option]').length
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-appearance-option]').length
    ).toBeLessThan(160);
    expect(screen.queryByText('Flags', { selector: 'h3' })).toBeNull();
    const categories = within(screen.getByLabelText('Emoji categories'));
    fireEvent.click(categories.getByRole('button', { name: 'Flags' }));
    await screen.findByText('Flags', { selector: 'h3' });
    expect(
      container.querySelectorAll('[data-appearance-option]').length
    ).toBeLessThan(160);
  });

  it('navigates to an unmounted last icon and renders it before focusing', async () => {
    renderPicker();
    const search = screen.getByRole('textbox', { name: 'Search icons' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    const asterisk = await screen.findByLabelText('Asterisk', {
      selector: 'button',
    });
    await waitFor(() => expect(document.activeElement).toBe(asterisk));
  });

  it('resets the emoji category when clearing search', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
    await screen.findByText('Smileys & people', { selector: 'h3' });
    const categories = within(screen.getByLabelText('Emoji categories'));
    const flags = categories.getByRole('button', { name: 'Flags' });
    fireEvent.click(flags);
    await screen.findByText('Flags', { selector: 'h3' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Search emoji' }), {
      target: { value: 'rocket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(flags.getAttribute('aria-pressed')).toBe('false');
    expect(
      categories
        .getByRole('button', { name: 'Smileys & people' })
        .getAttribute('aria-pressed')
    ).toBe('true');
  });

  it.each([
    {
      type: 'macro',
      label: 'Flag',
      icons: [
        { kind: 'macro', name: 'star' },
        { kind: 'macro', name: 'flag' },
        { kind: 'macro', name: 'heart' },
      ],
    },
    {
      type: 'emoji',
      label: '🚀',
      icons: [
        { kind: 'emoji', value: '😀' },
        { kind: 'emoji', value: '🚀' },
        { kind: 'emoji', value: '💡' },
      ],
    },
    {
      type: 'macro',
      mobile: true,
      label: 'Code',
      icons: [
        'star',
        'flag',
        'heart',
        'kanban',
        'file',
        'note',
        'table',
        'database',
        'code',
      ].map((name) => ({ kind: 'macro' as const, name })),
    },
  ] satisfies {
    type: string;
    label: string;
    icons: Icon[];
    mobile?: boolean;
  }[])(
    'retains focus when reordering Recent $type choices',
    async ({ type, label, icons, ...options }) => {
      const { container } = renderPicker(
        'mobile' in options && options.mobile,
        icons
      );
      if (type === 'emoji')
        fireEvent.click(screen.getByRole('radio', { name: 'Emoji' }));
      await screen.findByText('Recent', { selector: 'h3' });
      const chosen = Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[data-appearance-option]'
        )
      ).find(
        (button) =>
          button.dataset.appearanceOption?.startsWith('recent:') &&
          button.getAttribute('aria-label') === label
      );
      if (!chosen) throw new Error('Missing Recent choice');
      const key = chosen.dataset.appearanceOption;
      chosen.focus();
      fireEvent.click(chosen);
      await waitFor(() =>
        expect(
          document.activeElement?.getAttribute('data-appearance-option')
        ).toBe(key)
      );
      expect(
        container
          .querySelector('[data-appearance-option]')
          ?.getAttribute('data-appearance-option')
      ).toBe(key);
    }
  );
});

// Use the real menu, picker, and editor state; replace only the persistence adapter.
it('keeps the appearance submenu open while saving and returns to the parent menu', async () => {
  let finish: ((result: ReturnType<typeof ok<void>>) => void) | undefined;
  menuSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(() =>
    createComponent(Dropdown, {
      get children() {
        return [
          createComponent(Dropdown.Trigger, { children: 'Actions' }),
          createComponent(Dropdown.Content, {
            get children() {
              return createComponent(EntityAppearanceMenu, {
                entity: {
                  type: 'document',
                  id: 'document-1',
                  name: 'Document',
                  ownerId: 'picker-test',
                  fileType: 'md',
                },
              });
            },
          }),
        ];
      },
    })
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), {
    key: 'Enter',
  });
  const trigger = await screen.findByRole('menuitem', { name: 'Change icon' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const search = await screen.findByRole('textbox', { name: 'Search icons' });
  search.focus();
  fireEvent.keyDown(search, { key: 'ArrowLeft' });
  expect(screen.getByRole('textbox', { name: 'Search icons' })).toBe(search);
  fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
  expect(menuSave).toHaveBeenCalledWith({ icon: null, color: 'blue' });
  expect(screen.getByRole('textbox', { name: 'Search icons' })).toBe(search);
  finish?.(ok(undefined));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')
    ).toBe('true')
  );
  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Search icons' })).toBeNull()
  );
  expect(screen.getByRole('menuitem', { name: 'Change icon' })).toBe(trigger);
});
