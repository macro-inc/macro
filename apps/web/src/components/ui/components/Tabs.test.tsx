import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs, type TabsTouchStyle } from './Tabs';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('switches a controlled view by its visible label', () => {
  const [value, setValue] = createSignal<'all' | 'recent' | 'threads'>('all');
  render(() => (
    <>
      <Tabs
        aria-label="Conversation view"
        options={[
          { value: 'all', label: 'All' },
          { value: 'recent', label: 'Recent' },
          { value: 'threads', label: 'Threads' },
        ]}
        value={value()}
        onChange={setValue}
      />
      <p>Current view: {value()}</p>
    </>
  ));

  fireEvent.click(screen.getByText('Recent', { exact: true }));
  expect(screen.getByText('Current view: recent')).toBeTruthy();
  expect(
    screen.getByRole('radio', { name: 'Recent', checked: true })
  ).toBeTruthy();
  expect(
    screen.getByRole('radio', { name: 'All', checked: false })
  ).toBeTruthy();

  fireEvent.click(screen.getByText('Threads', { exact: true }));
  expect(screen.getByText('Current view: threads')).toBeTruthy();
});

it('keeps icon-only options named by their labels', () => {
  const [value, setValue] = createSignal<'messages' | 'files'>('messages');
  const Icon = (props: { class?: string }) => <svg class={props.class} />;
  render(() => (
    <Tabs
      aria-label="Channel sections"
      iconOnly
      options={[
        { value: 'messages', label: 'Messages', icon: Icon },
        { value: 'files', label: 'Attachments', icon: Icon },
      ]}
      value={value()}
      onChange={setValue}
    />
  ));

  fireEvent.click(screen.getByRole('radio', { name: 'Attachments' }));
  expect(value()).toBe('files');
});

it('does not select a disabled option', () => {
  const [value, setValue] = createSignal<'team' | 'personal'>('personal');
  render(() => (
    <Tabs
      aria-label="Owner"
      options={[
        { value: 'team', label: 'Team', disabled: true },
        { value: 'personal', label: 'Personal' },
      ]}
      value={value()}
      onChange={setValue}
    />
  ));

  fireEvent.click(screen.getByText('Team', { exact: true }));
  expect(value()).toBe('personal');
});

// Kobalte's sliding indicator measures the selected option.
const stubResizeObserver = () =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

it('slides the composer mode switch along its track on desktop', () => {
  stubResizeObserver();
  const [value, setValue] = createSignal<'chat' | 'code'>('chat');
  render(() => (
    <Tabs
      aria-label="Conversation mode"
      variant="track"
      options={[
        { value: 'chat', label: 'Chat' },
        { value: 'code', label: 'Code' },
      ]}
      value={value()}
      onChange={setValue}
    />
  ));

  fireEvent.click(screen.getByText('Code', { exact: true }));
  expect(value()).toBe('code');
  expect(document.querySelector('[role=presentation]')).not.toBeNull();
});

describe('on touch', () => {
  beforeEach(() => {
    device.touch = true;
    stubResizeObserver();
  });
  afterEach(() => {
    device.touch = false;
  });

  const renderTouch = (touch: TabsTouchStyle | undefined) => {
    const [value, setValue] = createSignal<'available' | 'unavailable'>(
      'available'
    );
    render(() => (
      <Tabs
        aria-label="Availability type"
        touch={touch}
        options={[
          { value: 'available', label: 'Available' },
          { value: 'unavailable', label: 'Unavailable' },
        ]}
        value={value()}
        onChange={setValue}
      />
    ));
    fireEvent.click(screen.getByText('Unavailable', { exact: true }));
    return {
      value,
      slidingPill: () => document.querySelector('[role=presentation]'),
    };
  };

  it.each([
    { touch: undefined, slides: true },
    { touch: 'pills' as const, slides: false },
  ])('selects with touch=$touch, sliding pill: $slides', (row) => {
    const { value, slidingPill } = renderTouch(row.touch);
    expect(value()).toBe('unavailable');
    expect(
      screen.getByRole('radio', { name: 'Unavailable', checked: true })
    ).toBeTruthy();
    expect(slidingPill() !== null).toBe(row.slides);
  });
});
