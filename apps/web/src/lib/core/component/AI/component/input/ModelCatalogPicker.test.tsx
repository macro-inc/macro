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
import {
  ModelCatalogMenu,
  ModelCatalogPicker,
  type ModelRowProps,
} from './ModelCatalogPicker';
import type { CatalogModelOption } from './modelCatalog';

const { isMobileWidth, setMobileWidth } = vi.hoisted(() => {
  let mobile = false;
  return {
    isMobileWidth: () => mobile,
    setMobileWidth: (value: boolean) => {
      mobile = value;
    },
  };
});

vi.mock('@core/mobile/mobileWidth', () => ({ isMobileWidth }));

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
  { id: 'opus', label: 'Opus 5.5 High' },
  { id: 'sonnet', label: 'Sonnet 5.5 High' },
  { id: 'sol', label: 'GPT-5.6 Sol High' },
  { id: 'gemini', label: 'Gemini 3.8 Flash High' },
];

afterEach(() => {
  cleanup();
  setMobileWidth(false);
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

describe('ModelCatalogMenu search focus', () => {
  it('puts caret in the search field when autoFocusSearch mounts the catalog', async () => {
    render(() => (
      <ModelCatalogMenu
        autoFocusSearch
        value="auto"
        options={OPTIONS}
        onSelect={() => {}}
      />
    ));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
  });

  it('reclaims search focus when the submenu trigger steals it', async () => {
    render(() => (
      <>
        <button type="button" id="agent-model-trigger">
          Agent
        </button>
        <div role="menu" aria-labelledby="agent-model-trigger">
          <ModelCatalogMenu
            autoFocusSearch
            value="auto"
            options={OPTIONS}
            onSelect={() => {}}
          />
        </div>
      </>
    ));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });

    const thief = screen.getByRole('button', { name: 'Agent' });
    thief.focus();
    expect(document.activeElement).toBe(thief);

    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
  });

  it('allows focus to move into a nested effort menu', async () => {
    render(() => (
      <>
        <div role="menu" aria-labelledby="agent-model-trigger">
          <ModelCatalogMenu
            autoFocusSearch
            value="auto"
            options={OPTIONS}
            onSelect={() => {}}
          />
        </div>
        <div role="menu" aria-label="Effort">
          <button type="button">High</button>
        </div>
      </>
    ));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    const effort = screen.getByRole('button', { name: 'High' });
    effort.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(effort);
  });

  it('keeps initial search focus until the user navigates a model row', async () => {
    render(() => (
      <div role="menu" aria-labelledby="agent-model-trigger">
        <ModelCatalogMenu
          autoFocusSearch
          value="auto"
          options={OPTIONS}
          onSelect={() => {}}
        />
        <button type="button" role="menuitem">
          Selected model
        </button>
      </div>
    ));
    const search = screen.getByRole('textbox', { name: 'Search models' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    const model = screen.getByRole('menuitem', { name: 'Selected model' });
    model.focus();
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.pointerMove(model);
    model.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(model);
  });
});

describe('ModelCatalogPicker more models at phone width', () => {
  it('replaces the list in place and comes back', () => {
    setMobileWidth(true);
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Agent model' }));

    expect(screen.queryByText('Gemini 3.8 Flash High')).toBeNull();

    fireEvent.click(screen.getByText('More models'));
    expect(screen.getByText('Gemini 3.8 Flash High')).toBeTruthy();
    expect(screen.queryByText('Opus 5.5 High')).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Recommended' }));
    expect(screen.getByText('Opus 5.5 High')).toBeTruthy();
    expect(screen.queryByText('Gemini 3.8 Flash High')).toBeNull();
  });

  it('uses the supplied model row for models beyond the recommended list', () => {
    setMobileWidth(true);
    const CustomRow = (props: ModelRowProps) => (
      <button type="button" onClick={props.onSelect}>
        Custom {props.option.label}
      </button>
    );
    render(() => {
      const [value, setValue] = createSignal('auto');
      return (
        <ModelCatalogPicker
          value={value()}
          options={OPTIONS}
          onSelect={setValue}
          modelRow={CustomRow}
          ariaLabel="Agent model"
        />
      );
    });

    fireEvent.click(screen.getByText('More models'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Custom Gemini 3.8 Flash High' })
    );
    expect(
      screen.getByRole('button', { name: 'Agent model' }).textContent
    ).toContain('Gemini 3.8 Flash High');
  });
});
