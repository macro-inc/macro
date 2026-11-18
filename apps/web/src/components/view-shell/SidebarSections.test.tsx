import { fireEvent, render } from '@solidjs/testing-library';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { createSignal, Show } from 'solid-js';
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
  const result = render(() => (
    <DragDropProvider>
      <ViewSidebar.Root reorderId={view}>
        <ViewSidebar.Content>
          <button type="button">Fixed top</button>
          <Section id="first" />
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
  return { ...result, order, setExtra };
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
});
