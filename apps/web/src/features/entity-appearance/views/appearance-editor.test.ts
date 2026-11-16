import { fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceEditor } from './appearance-editor';

const LAYOUT = vi.hoisted(() => ({ read: (): boolean => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => LAYOUT.read() }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

it('keeps the picker and its search when switching between popover and sheet', async () => {
  let setMobile: (value: boolean) => void = () => {};
  render(() => {
    const [mobile, updateMobile] = createSignal(false);
    LAYOUT.read = mobile;
    setMobile = updateMobile;
    return createComponent(AppearanceEditor, {
      open: true,
      onOpenChange: vi.fn(),
      userId: 'editor',
      entity: {
        type: 'document',
        id: 'document',
        ownerId: 'editor',
        name: 'Note',
        fileType: 'md',
      },
      isCurrent: () => true,
      save: async () => ok(undefined),
    });
  });
  const search = screen.getByRole('textbox', { name: 'Search icons' });
  fireEvent.input(search, { target: { value: 'calendar' } });
  setMobile(true);
  const mobileSearch = await screen.findByRole('textbox', {
    name: 'Search icons',
  });
  expect(mobileSearch).toBe(search);
  expect(mobileSearch instanceof HTMLInputElement && mobileSearch.value).toBe(
    'calendar'
  );
  setMobile(false);
  expect(await screen.findByRole('textbox', { name: 'Search icons' })).toBe(
    search
  );
});
