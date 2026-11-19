import { fireEvent, render } from '@solidjs/testing-library';
import { DragDropProvider, DragDropSensors } from '@thisbeyond/solid-dnd';
import { transform } from 'lightningcss';
import { createSignal, Show } from 'solid-js';
import { compile } from 'tailwindcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';
import { ViewSidebar } from './ViewSidebar';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'sidebar-viewer',
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Section(props: { id: string }) {
  const [open, setOpen] = createSignal(true);
  return (
    <CollapsibleSection.Root
      sectionId={props.id}
      sectionLabel={props.id}
      open={open()}
      onOpenChange={setOpen}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger>{props.id}</CollapsibleSection.Trigger>
        <CollapsibleSection.Action
          aria-label={`Action ${props.id}`}
          onClick={() => setOpen(true)}
        >
          +
        </CollapsibleSection.Action>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <input aria-label={`Input ${props.id}`} />
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function sidebar(view = 'test') {
  const [extra, setExtra] = createSignal(false);
  const [firstVisible, setFirstVisible] = createSignal(true);
  const result = render(() => (
    <DragDropProvider>
      <ViewSidebar.Root reorderId={view}>
        <ViewSidebar.Content>
          <button type="button">Fixed top</button>
          <Show when={firstVisible()}>
            <Section id="first" />
          </Show>
          <Show when={extra()}>
            <Section id="new" />
          </Show>
          <Section id="last" />
          <button type="button">Fixed bottom</button>
        </ViewSidebar.Content>
      </ViewSidebar.Root>
    </DragDropProvider>
  ));
  const order = () =>
    [...result.container.querySelectorAll('[data-sidebar-section]')].map(
      (node) => node.getAttribute('data-sidebar-section')
    );
  return { ...result, order, setExtra, setFirstVisible };
}

describe('sidebar section composition', () => {
  it('moves the same section DOM, keeps fixed rows, and restores per view', () => {
    const first = sidebar();
    const field = first.getByLabelText('Input last');
    fireEvent.input(field, { target: { value: 'preserved' } });
    const firstTrigger = first.getByRole('button', { name: 'first' });
    fireEvent.click(firstTrigger);
    const handle = first.getByRole('button', { name: 'Reorder last' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(first.order()).toEqual(['last', 'first']);
    expect(first.getByLabelText('Input last')).toBe(field);
    expect(field instanceof HTMLInputElement && field.value).toBe('preserved');
    expect(document.activeElement).toBe(handle);
    expect(firstTrigger.getAttribute('aria-expanded')).toBe('false');
    const content = first.container.querySelector(
      '[data-view-sidebar-content]'
    );
    expect(content?.firstElementChild?.textContent).toBe('Fixed top');
    expect(content?.lastElementChild?.textContent).toBe('Fixed bottom');
    first.unmount();
    const restored = sidebar();
    expect(restored.order()).toEqual(['last', 'first']);
    restored.unmount();
    const independent = sidebar('different-view');
    expect(independent.order()).toEqual(['first', 'last']);
  });

  it('keeps new sections in their default slot and removes hidden sections', () => {
    const result = sidebar();
    fireEvent.keyDown(result.getByRole('button', { name: 'Reorder last' }), {
      key: 'ArrowUp',
    });
    result.setExtra(true);
    expect(result.order()).toEqual(['last', 'new', 'first']);
    result.setExtra(false);
    expect(result.order()).toEqual(['last', 'first']);
  });

  it('keeps collapse and independent header actions usable', () => {
    const result = sidebar();
    const trigger = result.getByRole('button', { name: 'first' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(result.getByRole('button', { name: 'Action first' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(result.order()).toEqual(['first', 'last']);
  });

  it('keeps nested disclosure headers out of section reordering', () => {
    const result = render(() => (
      <DragDropProvider>
        <ViewSidebar.Root reorderId="nested">
          <ViewSidebar.Content>
            <CollapsibleSection.Root
              sectionId="outer"
              sectionLabel="Outer"
              open
              onOpenChange={() => {}}
            >
              <CollapsibleSection.Header>
                <CollapsibleSection.Trigger>Outer</CollapsibleSection.Trigger>
              </CollapsibleSection.Header>
              <CollapsibleSection.Content>
                <CollapsibleSection.Root open onOpenChange={() => {}}>
                  <CollapsibleSection.Header>
                    <CollapsibleSection.Trigger>
                      Nested
                    </CollapsibleSection.Trigger>
                  </CollapsibleSection.Header>
                </CollapsibleSection.Root>
              </CollapsibleSection.Content>
            </CollapsibleSection.Root>
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </DragDropProvider>
    ));
    expect(
      result.getAllByRole('button', { name: 'Reorder Outer' })
    ).toHaveLength(1);
    expect(result.queryByRole('button', { name: 'Reorder Nested' })).toBeNull();
  });

  it('retains a hidden section position when visible sections move', () => {
    const result = sidebar();
    result.setExtra(true);
    const last = result.getByRole('button', { name: 'Reorder last' });
    fireEvent.keyDown(last, { key: 'ArrowUp' });
    fireEvent.keyDown(last, { key: 'ArrowUp' });
    result.setFirstVisible(false);
    fireEvent.keyDown(result.getByRole('button', { name: 'Reorder new' }), {
      key: 'ArrowUp',
    });
    result.setFirstVisible(true);
    expect(result.order()).toEqual(['new', 'first', 'last']);
  });

  it('preserves named section regions and excludes checkbox labels from dragging', () => {
    vi.useFakeTimers();
    const dragStarted = vi.fn();
    const result = render(() => (
      <DragDropProvider onDragStart={dragStarted}>
        <DragDropSensors />
        <ViewSidebar.Root reorderId="labels">
          <ViewSidebar.Content>
            <ViewSidebar.Section id="plain" label="Plain section">
              <ViewSidebar.SectionHeader>
                <h2>Plain section</h2>
                <label data-testid="checkbox-label">
                  <input type="checkbox" aria-label="Show calendar" />
                  Calendar
                </label>
              </ViewSidebar.SectionHeader>
            </ViewSidebar.Section>
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </DragDropProvider>
    ));
    expect(result.getByRole('region', { name: 'Plain section' }).tagName).toBe(
      'SECTION'
    );
    const label = result.getByTestId('checkbox-label');
    fireEvent.mouseDown(label, { button: 0, clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(300);
    expect(dragStarted).not.toHaveBeenCalled();
    fireEvent.mouseMove(document, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(document);
    vi.useRealTimers();
    expect(dragStarted).not.toHaveBeenCalled();
    fireEvent.click(label);
    const checkbox = result.getByRole('checkbox', { name: 'Show calendar' });
    expect(checkbox instanceof HTMLInputElement && checkbox.checked).toBe(true);
  });

  it('reorders unnamed groups with headed sections while ignoring saved pinned keys', () => {
    localStorage.setItem(
      'sidebar-section-order:pinned:sidebar-viewer',
      JSON.stringify({
        version: 1,
        order: ['last', 'accounts', 'mail-folders', 'footer'],
      })
    );
    const result = render(() => (
      <DragDropProvider>
        <ViewSidebar.Root reorderId="pinned">
          <ViewSidebar.Content>
            <ViewSidebar.Section id="accounts" label="Accounts" pinned>
              <ViewSidebar.SectionHeader>
                <h2>Accounts</h2>
              </ViewSidebar.SectionHeader>
              <button type="button">Select account</button>
            </ViewSidebar.Section>
            <ViewSidebar.Section
              id="mail-folders"
              label="Mail folders"
              headerless
            >
              <button type="button">Inbox</button>
            </ViewSidebar.Section>
            <Section id="last" />
            <ViewSidebar.Section id="footer" label="Footer" pinned>
              <button type="button">Settings</button>
            </ViewSidebar.Section>
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </DragDropProvider>
    ));
    const order = () =>
      [...result.container.querySelectorAll('[data-sidebar-section]')].map(
        (node) => node.getAttribute('data-sidebar-section')
      );
    const folders = result.getByRole('region', { name: 'Mail folders' });
    expect(folders.textContent).toBe('Inbox');
    expect(folders.querySelector('h1, h2, h3')).toBeNull();
    expect(order()).toEqual(['accounts', 'last', 'mail-folders', 'footer']);
    expect(
      result.queryByRole('button', { name: 'Reorder Accounts' })
    ).toBeNull();
    expect(result.queryByRole('button', { name: 'Reorder Footer' })).toBeNull();
    const handle = result.getByRole('button', { name: 'Reorder Mail folders' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(order()).toEqual(['accounts', 'mail-folders', 'last', 'footer']);
    expect(document.activeElement).toBe(handle);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(order()).toEqual(['accounts', 'mail-folders', 'last', 'footer']);
    expect(
      JSON.parse(
        localStorage.getItem('sidebar-section-order:pinned:sidebar-viewer') ??
          '{}'
      ).order
    ).toEqual(['mail-folders', 'last']);
  });

  it('keeps the first row at the same left offset without a grip, hidden, or shown', async () => {
    const result = render(() => (
      <DragDropProvider>
        <ViewSidebar.Root reorderId="grip-layout">
          <ViewSidebar.Content>
            <ViewSidebar.Section id="reference" label="Reference" pinned>
              <ViewSidebar.Item>Reference row</ViewSidebar.Item>
            </ViewSidebar.Section>
            <ViewSidebar.Section id="folders" label="Folders" headerless>
              <ViewSidebar.Item>First row</ViewSidebar.Item>
            </ViewSidebar.Section>
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </DragDropProvider>
    ));
    // Compile the rendered utilities instead of mocking padding or relying on
    // jsdom's always-zero bounding boxes. Visibility is controlled below because
    // jsdom does not implement hover/focus-within layout.
    const compiler = await compile(
      '@theme inline { --spacing: 4px; } @tailwind utilities;'
    );
    const classes = [...result.container.querySelectorAll('[class]')].flatMap(
      (element) => [...element.classList].filter((name) => !name.includes(':'))
    );
    const stylesheet = document.createElement('style');
    stylesheet.textContent = transform({
      filename: 'sidebar-grip-layout.css',
      code: Buffer.from(compiler.build(classes)),
      minify: true,
      targets: { chrome: 80 << 16 },
    }).code.toString();
    document.head.append(stylesheet);
    try {
      const firstRow = result.getByRole('button', { name: 'First row' });
      const referenceRow = result.getByRole('button', {
        name: 'Reference row',
      });
      const grip = result.getByRole('button', { name: 'Reorder Folders' });
      const overlay = grip.parentElement;
      if (!overlay) throw new Error('Missing grip overlay');
      // Sum computed box insets to the section, including every extra wrapper.
      const rowLeft = (row: HTMLElement) => {
        let offset = 0;
        for (
          let node: HTMLElement | null = row;
          node && node.tagName !== 'SECTION';
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          offset += Number.parseFloat(style.marginLeft) || 0;
          if (node !== row) {
            offset += Number.parseFloat(style.paddingLeft) || 0;
            offset += Number.parseFloat(style.borderLeftWidth) || 0;
          }
        }
        return offset;
      };
      const referenceLeft = rowLeft(referenceRow);
      expect(getComputedStyle(overlay).position).toBe('absolute');
      expect(getComputedStyle(overlay).opacity).toBe('0');
      expect(rowLeft(firstRow)).toBe(referenceLeft);
      overlay.style.opacity = '1';
      grip.focus();
      expect(getComputedStyle(overlay).opacity).toBe('1');
      expect(rowLeft(firstRow)).toBe(referenceLeft);
      grip.blur();
      overlay.style.opacity = '0';
      expect(rowLeft(firstRow)).toBe(referenceLeft);
    } finally {
      stylesheet.remove();
    }
  });

  it('starts unnamed-section dragging from its grip, not its navigation buttons', () => {
    const dragStarted = vi.fn();
    const result = render(() => (
      <DragDropProvider onDragStart={dragStarted}>
        <DragDropSensors />
        <ViewSidebar.Root reorderId="unnamed-pointer">
          <ViewSidebar.Content>
            <ViewSidebar.Section
              id="mail-folders"
              label="Mail folders"
              headerless
            >
              <button type="button">Inbox</button>
            </ViewSidebar.Section>
            <Section id="last" />
          </ViewSidebar.Content>
        </ViewSidebar.Root>
      </DragDropProvider>
    ));
    fireEvent.mouseDown(result.getByRole('button', { name: 'Inbox' }), {
      button: 0,
      clientY: 0,
    });
    fireEvent.mouseMove(document, { clientY: 20 });
    fireEvent.mouseUp(document);
    expect(dragStarted).not.toHaveBeenCalled();
    fireEvent.mouseDown(
      result.getByRole('button', { name: 'Reorder Mail folders' }),
      { button: 0, clientY: 0 }
    );
    fireEvent.mouseMove(document, { clientY: 20 });
    expect(dragStarted).toHaveBeenCalledOnce();
    fireEvent.mouseUp(document);
  });
});
