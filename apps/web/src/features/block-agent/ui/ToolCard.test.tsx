/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCard } from './ToolCard';

vi.mock('@phosphor/caret-right.svg', () => ({ default: () => <svg /> }));

afterEach(cleanup);

describe('ToolCard', () => {
  it('constructs expensive content only on expansion and disposes it on close', async () => {
    const mounted = vi.fn();
    const disposed = vi.fn();
    function Body() {
      mounted();
      onCleanup(disposed);
      return <div>Diff contents</div>;
    }
    const view = render(() => (
      <ToolCard title="Edit" status="completed">
        <Body />
      </ToolCard>
    ));
    expect(mounted).not.toHaveBeenCalled();
    const trigger = view.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(view.getByText('Diff contents')).toBeTruthy();
    trigger.click();
    await waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    trigger.click();
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it('updates conditional content availability without constructing the body', () => {
    const [available, setAvailable] = createSignal(false);
    const mounted = vi.fn();
    const view = render(() => (
      <ToolCard title="Bash" status="running" hasContent={available()}>
        {mounted()}
        <div>Output</div>
      </ToolCard>
    ));
    expect(view.queryByRole('button')).toBeNull();
    setAvailable(true);
    expect(view.getByRole('button')).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
    view.getByRole('button').click();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('supports controlled expansion without mounting until the owner opens it', () => {
    const [open, setOpen] = createSignal(false);
    const onOpenChange = vi.fn();
    const mounted = vi.fn();
    const view = render(() => (
      <ToolCard
        title="Edit"
        status="completed"
        open={open()}
        onOpenChange={onOpenChange}
      >
        {mounted()}
        <div>Diff</div>
      </ToolCard>
    ));
    view.getByRole('button').click();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(mounted).not.toHaveBeenCalled();
    setOpen(true);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('renders default-open content and leaves bodyless cards noninteractive', () => {
    const view = render(() => (
      <>
        <ToolCard title="Question" status="running" defaultOpen>
          <input aria-label="Answer" />
        </ToolCard>
        <ToolCard title="Read" status="completed" />
      </>
    ));
    expect(view.getByRole('textbox', { name: 'Answer' })).toBeTruthy();
    expect(view.getAllByRole('button')).toHaveLength(1);
  });
});
