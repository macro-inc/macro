/**
 * @vitest-environment jsdom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelCatalogPicker } from './ModelCatalogPicker';
import type { CatalogModelOption } from './modelCatalog';

vi.mock('@ui', () => {
  const cn = (...args: unknown[]) =>
    args.flat(Infinity).filter(Boolean).join(' ');

  let onOpenAutoFocus: ((event: Event) => void) | undefined;

  const Dropdown: any = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );
  Dropdown.Trigger = (props: {
    children?: JSX.Element;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      aria-label={props['aria-label']}
      onClick={() => {
        const event = new Event('focusScope.autoFocusOnMount', {
          cancelable: true,
        });
        onOpenAutoFocus?.(event);
        // Kobalte's selectable list still autofocuses the collection on a
        // deferred timeout after onOpenAutoFocus is prevented.
        setTimeout(() => {
          document.getElementById('model-catalog-menu')?.focus();
        }, 0);
      }}
    >
      {props.children}
    </button>
  );
  Dropdown.Content = (props: {
    children?: JSX.Element;
    onOpenAutoFocus?: (event: Event) => void;
  }) => {
    onOpenAutoFocus = props.onOpenAutoFocus;
    return (
      <div id="model-catalog-menu" role="menu" tabIndex={-1}>
        {props.children}
      </div>
    );
  };
  Dropdown.Group = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );
  Dropdown.GroupLabel = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );
  Dropdown.Item = (props: {
    children?: JSX.Element;
    onSelect?: () => void;
  }) => (
    <div role="menuitem" onClick={() => props.onSelect?.()}>
      {props.children}
    </div>
  );
  Dropdown.Separator = () => <hr />;
  Dropdown.Sub = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );
  Dropdown.SubTrigger = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );
  Dropdown.SubContent = (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  );

  return { cn, Dropdown };
});

const OPTIONS: CatalogModelOption[] = [
  { id: 'auto', label: 'Auto', group: 'Auto' },
  { id: 'grok', label: 'Cursor Grok 4.6 High Fast' },
  { id: 'opus', label: 'Claude Opus 5 High' },
  { id: 'sonnet', label: 'Claude Sonnet 5 High' },
  { id: 'sol', label: 'GPT-5.6 Sol High' },
  { id: 'gemini', label: 'Gemini 3.8 Flash High' },
];

afterEach(() => {
  cleanup();
});

function mountPicker() {
  render(() => {
    const [value, setValue] = createSignal('auto');
    return (
      <ModelCatalogPicker
        value={value()}
        options={OPTIONS}
        onSelect={setValue}
        ariaLabel="Agent model"
      />
    );
  });
}

describe('ModelCatalogPicker search focus', () => {
  it('puts caret in the search field when the menu opens', async () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Agent model' }));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
  });

  it('puts caret in the search field when the menu is opened again', async () => {
    mountPicker();
    const trigger = screen.getByRole('button', { name: 'Agent model' });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Search models' })
      );
    });

    document.getElementById('model-catalog-menu')?.focus();
    expect(document.activeElement).not.toBe(
      screen.getByRole('textbox', { name: 'Search models' })
    );

    fireEvent.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Search models' })
      );
    });
  });
});
