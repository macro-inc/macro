import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import { ToolsStep } from './ToolsStep';

const state = vi.hoisted(() => ({
  hosted: false,
  error: false,
  pending: false,
  nextPageError: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: readonly unknown[];
    children: (row: unknown, index: () => number) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));
vi.mock('@solid-primitives/media', () => ({
  createMediaQuery: () => () => true,
}));
vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => state.hosted,
}));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogSearch: (exclude: () => Set<string>) => {
    const [search, setSearch] = createSignal('');
    return {
      query: {
        isSuccess: !state.error && !state.pending,
        isError: state.error,
        isFetching: state.pending,
        isFetchNextPageError: state.nextPageError,
        hasNextPage: state.hasNextPage,
        fetchNextPage: state.fetchNextPage,
        refetch: state.refetch,
      },
      entries: () => {
        if (state.pending)
          throw new Error('Pending query data must not be read');
        return [
          { app_slug: 'google_sheets', display_name: 'Google Sheets' },
          { app_slug: 'google_calendar', display_name: 'Google Calendar' },
          { app_slug: 'slack_v2', display_name: 'Slack' },
          { app_slug: 'gmail', display_name: 'Gmail' },
          { app_slug: 'microsoft_outlook', display_name: 'Microsoft Outlook' },
          { app_slug: 'google_drive', display_name: 'Google Drive' },
          { app_slug: 'linear', display_name: 'Linear' },
          { app_slug: 'notion', display_name: 'Notion' },
          { app_slug: 'slack', display_name: 'Slack' },
          { app_slug: 'figma', display_name: 'Figma' },
        ].filter((entry) => !exclude().has(entry.app_slug));
      },
      search,
      searchInput: search,
      onSearchInput: setSearch,
    };
  },
}));
afterEach(cleanup);
beforeEach(() => {
  state.hosted = false;
  state.error = false;
  state.pending = false;
  state.nextPageError = false;
  state.hasNextPage = false;
  state.fetchNextPage.mockReset();
  state.refetch.mockReset();
});

function Picker(props: { onContinue: () => void }) {
  const [selected, setSelected] = createSignal<OnboardingIntegration[]>([]);
  return (
    <ToolsStep
      connectorNames={['Linear', 'Notion', 'GitHub']}
      selected={selected()}
      onSelectionChange={setSelected}
      onContinue={props.onContinue}
    />
  );
}

describe('onboarding integration selection', () => {
  it('selects tools without starting authorization and retains choices while searching', () => {
    const next = vi.fn();
    const view = render(() => <Picker onContinue={next} />);
    fireEvent.click(view.getByRole('button', { name: 'Select Notion' }));
    expect(
      view
        .getByRole('button', { name: 'Deselect Notion' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      view.getByRole('button', { name: 'Continue with 1 integration' })
    ).toBeTruthy();
    expect(next).not.toHaveBeenCalled();
    fireEvent.input(
      view.getByRole('searchbox', { name: 'Search integrations and MCPs' }),
      { target: { value: 'GitHub' } }
    );
    expect(view.queryByRole('button', { name: 'Deselect Notion' })).toBeNull();
    expect(
      view.getByRole('button', { name: 'Continue with 1 integration' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Select GitHub' }));
    fireEvent.click(
      view.getByRole('button', { name: 'Continue with 2 integrations' })
    );
    expect(next).toHaveBeenCalledOnce();
  });
  it('selects generic catalog entries and allows removing a selected tool', () => {
    state.hosted = true;
    const view = render(() => <Picker onContinue={() => {}} />);
    fireEvent.click(view.getByRole('button', { name: 'Select Figma' }));
    expect(view.getByRole('button', { name: 'Deselect Figma' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Deselect Figma' }));
    expect(view.getByRole('button', { name: 'Select Figma' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
  it('puts bespoke connectors before MCPs, deduplicates, and hides excluded entries', () => {
    state.hosted = true;
    const view = render(() => <Picker onContinue={() => {}} />);
    const entries = view.getAllByRole('button', { name: /^Select / });
    expect(entries.slice(0, 3).map((entry) => entry.textContent)).toEqual([
      'LinearNative',
      'NotionNative',
      'GitHubNative',
    ]);
    expect(
      view.getByRole('button', { name: 'Select PostHog' }).textContent
    ).toBe('PostHogMCP');
    expect(
      view.getByRole('button', { name: 'Select Google Drive' }).textContent
    ).toBe('Google DriveMCP');
    expect(view.getAllByRole('button', { name: 'Select Linear' })).toHaveLength(
      1
    );
    for (const name of [
      'Google Sheets',
      'Google Calendar',
      'Gmail',
      'Microsoft Outlook',
      'Slack',
    ]) {
      expect(view.queryByRole('button', { name: `Select ${name}` })).toBeNull();
    }
  });
  it.each(['pending', 'error'] as const)(
    'retains bundled connections during catalog %s',
    (status) => {
      state.hosted = true;
      state[status] = true;
      const view = render(() => <Picker onContinue={() => {}} />);
      expect(view.getByRole('button', { name: 'Select GitHub' })).toBeTruthy();
      expect(view.queryByRole('button', { name: 'Select Figma' })).toBeNull();
      if (status === 'error')
        expect(
          view.getByText('Couldn’t load the connector catalog.')
        ).toBeTruthy();
    }
  );
  it('loads another page near the end and coalesces repeated scrolls', async () => {
    state.hosted = true;
    state.hasNextPage = true;
    let finish!: () => void;
    state.fetchNextPage.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const view = render(() => <Picker onContinue={() => {}} />);
    const results = view.getByRole('region', {
      name: 'Available integrations',
    });
    Object.defineProperties(results, {
      scrollHeight: { value: 1600 },
      clientHeight: { value: 512 },
    });
    fireEvent.scroll(results);
    expect(state.fetchNextPage).not.toHaveBeenCalled();
    results.scrollTop = 900;
    fireEvent.scroll(results);
    fireEvent.scroll(results);
    expect(state.fetchNextPage).toHaveBeenCalledOnce();
    expect(
      view.queryByRole('button', { name: 'Show more integrations' })
    ).toBeNull();
    finish();
    await Promise.resolve();
  });
  it('retains loaded connectors after a pagination error and retries that page', () => {
    state.hosted = true;
    state.error = true;
    state.nextPageError = true;
    state.hasNextPage = true;
    const view = render(() => <Picker onContinue={() => {}} />);
    expect(view.getByRole('button', { name: 'Select Figma' })).toBeTruthy();
    fireEvent.scroll(
      view.getByRole('region', { name: 'Available integrations' })
    );
    expect(state.fetchNextPage).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(state.fetchNextPage).toHaveBeenCalledOnce();
    expect(state.refetch).not.toHaveBeenCalled();
  });
  it('does not fetch beyond the end of the catalog', () => {
    state.hosted = true;
    const view = render(() => <Picker onContinue={() => {}} />);
    fireEvent.scroll(
      view.getByRole('region', { name: 'Available integrations' })
    );
    expect(state.fetchNextPage).not.toHaveBeenCalled();
  });
  it('continues with no selections and has no redundant skip action', () => {
    const next = vi.fn();
    const view = render(() => <Picker onContinue={next} />);
    expect(
      view.queryByRole('button', { name: 'Set up integrations later' })
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(next).toHaveBeenCalledOnce();
  });
});
