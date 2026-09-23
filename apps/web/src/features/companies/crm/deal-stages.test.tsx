import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { createMemo, Show, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRM_TEAM_STAGE_DEFINITION_NAME, useDealStages } from './deal-stages';

const mocks = vi.hoisted(() => ({ definitions: vi.fn() }));
vi.mock('@queries/properties/definitions', () => ({
  useListPropertiesQuery: () => mocks.definitions(),
}));
vi.mock('./team-crm-config', () => ({
  useTeamCrmConfig: () => ({ config: () => ({}), isLoading: () => false }),
}));

const customized: PropertyDefinitionWithOptions = {
  definition: {
    id: 'team-stages',
    display_name: CRM_TEAM_STAGE_DEFINITION_NAME,
    data_type: 'SELECT_STRING',
    is_metadata: false,
    is_multi_select: false,
    is_system: false,
    owner: { scope: 'team', team_id: 'team' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  property_options: [
    {
      id: 'qualified',
      property_definition_id: 'team-stages',
      display_order: 0,
      value: { type: 'string', value: 'Qualified' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
};

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});

function mount(consumeStages: boolean, providerOwned = false) {
  const response = Promise.withResolvers<PropertyDefinitionResponse[]>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  mocks.definitions.mockImplementation(() =>
    useQuery(() => ({
      queryKey: ['test-team-definitions'],
      queryFn: () => response.promise,
    }))
  );
  function View() {
    const stages = useDealStages();
    return consumeStages ? (
      <div data-testid="stages">
        {stages.stageDefinitionId()}:
        {stages
          .stages()
          .map((stage) => stage.label)
          .join(',')}
      </div>
    ) : (
      <div data-testid="document">Cached document</div>
    );
  }
  function ProviderOwnedView() {
    // SoupViewContextProvider creates its stage source and grouping memo
    // above the CRM child's boundary. SplitPanel wraps the provider itself.
    const stages = useDealStages();
    const group = createMemo(() => {
      if (!consumeStages) return 'Cached document';
      const stage = stages.resolveStage({
        properties: [
          {
            definition: { id: 'team-stages' },
            value: { type: 'SelectOption', value: ['qualified'] },
          },
        ],
      });
      return `${stages.stageDefinitionId()}:${stages
        .stages()
        .map((entry) => entry.label)
        .join(',')}:${stage ?? 'Not set'}`;
    });
    return (
      <Suspense fallback={<div data-testid="crm-loading" />}>
        <div data-testid={consumeStages ? 'stages' : 'document'}>{group()}</div>
      </Suspense>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <div data-testid="split-chrome">Split chrome</div>
      <Suspense fallback={<div data-testid="loading" />}>
        <Show when={providerOwned} fallback={<View />}>
          <ProviderOwnedView />
        </Show>
      </Suspense>
    </QueryClientProvider>
  ));
  return { response, client };
}

describe('deal-stage projections in shared soup contexts', () => {
  it('does not suspend an unrelated document while team definitions are pending', () => {
    mount(false);
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.getByTestId('document').textContent).toBe('Cached document');
  });

  it('still suspends a CRM consumer until its team-specific stages are known', async () => {
    const h = mount(true);
    expect(screen.queryByTestId('stages')).toBeNull();
    expect(screen.getByTestId('loading')).toBeTruthy();
    h.response.resolve([customized]);
    await waitFor(() =>
      expect(screen.getByTestId('stages').textContent).toBe(
        'team-stages:Qualified'
      )
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    h.client.setQueryData(
      ['test-team-definitions'],
      [
        {
          ...customized,
          property_options: [
            {
              ...customized.property_options[0],
              value: { type: 'string', value: 'Updated' },
            },
          ],
        },
      ]
    );
    await waitFor(() =>
      expect(screen.getByTestId('stages').textContent).toBe(
        'team-stages:Updated'
      )
    );
  });

  it('keeps provider-owned grouping hidden under the split boundary until custom stages resolve', async () => {
    const h = mount(true, true);
    expect(screen.getByTestId('split-chrome')).toBeTruthy();
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('crm-loading')).toBeNull();
    expect(screen.queryByTestId('stages')).toBeNull();
    expect(screen.queryByText(/Not set/)).toBeNull();
    h.response.resolve([customized]);
    await waitFor(() =>
      expect(screen.getByTestId('stages').textContent).toBe(
        'team-stages:Qualified:qualified'
      )
    );
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('does not suspend provider-owned document views on unused CRM queries', () => {
    mount(false, true);
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByTestId('crm-loading')).toBeNull();
    expect(screen.getByTestId('document').textContent).toBe('Cached document');
  });

  it('uses system defaults only after resolving that the team has no custom definition', async () => {
    const h = mount(true);
    expect(screen.queryByTestId('stages')).toBeNull();
    h.response.resolve([]);
    await waitFor(() =>
      expect(screen.getByTestId('stages').textContent).toContain(
        SYSTEM_PROPERTY_IDS.STAGE
      )
    );
  });
});
