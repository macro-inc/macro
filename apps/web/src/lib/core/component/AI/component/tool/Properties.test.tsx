/**
 * @vitest-environment jsdom
 */

import { propertiesKeys } from '@queries/properties/keys';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { PropertyOptionValue } from '@service-properties/generated/schemas/propertyOptionValue';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { TagSetResponseDefinition } from '@service-properties/generated/schemas/tagSetResponseDefinition';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bulkSetEntityPropertyOptionsHandler,
  setEntityPropertyHandler,
} from './Properties';

vi.mock('@core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/auth')>()),
  useIsAuthenticated: () => () => true,
}));

const TAG_DEF = 'tag-def-1';
const STATUS_DEF = 'status-def';

function stringValue(value: string): PropertyOptionValue {
  return { type: 'string', value } as PropertyOptionValue;
}

function tagOption(
  id: string,
  label: string,
  color: string
): PropertyOptionResponse {
  return {
    id,
    propertyDefinitionId: TAG_DEF,
    displayOrder: 0,
    value: stringValue(label),
    color,
  };
}

const tagSets: TagSetResponse[] = [
  {
    scope: 'user',
    definition: { id: TAG_DEF } as TagSetResponseDefinition,
    options: [
      tagOption('opt-follow', 'Follow-up', 'rgb(220, 38, 38)'),
      tagOption('opt-urgent', 'Urgent', 'rgb(37, 99, 235)'),
    ],
  },
];

const statusOptions: PropertyOption[] = [
  {
    id: 'status-done',
    property_definition_id: STATUS_DEF,
    display_order: 0,
    value: stringValue('Done'),
    color: 'rgb(16, 185, 129)',
    created_at: '',
    updated_at: '',
  },
];

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  client.setQueryData(propertiesKeys.tags.queryKey, tagSets);
  client.setQueryData(
    propertiesKeys.options({ propertyDefinitionId: STATUS_DEF }).queryKey,
    statusOptions
  );
  client.setQueryData(
    propertiesKeys.options({ propertyDefinitionId: 'empty-def' }).queryKey,
    []
  );
  return client;
}

function renderTool<
  TName extends 'SetEntityProperty' | 'BulkSetEntityPropertyOptions',
>(handler: { render: Component<never> }, tool: NamedTool<TName, 'call'>) {
  const client = makeClient();
  return render(() => (
    <QueryClientProvider client={client}>
      <Dynamic
        component={handler.render as Component<Record<string, unknown>>}
        tool={tool}
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete={false}
        renderContext={{ isStreaming: false, grouped: false }}
      />
    </QueryClientProvider>
  ));
}

function bulkTool(
  data: NamedTool<'BulkSetEntityPropertyOptions', 'call'>['data']
): NamedTool<'BulkSetEntityPropertyOptions', 'call'> {
  return { id: 'tool-1', name: 'BulkSetEntityPropertyOptions', data };
}

function setTool(
  data: NamedTool<'SetEntityProperty', 'call'>['data']
): NamedTool<'SetEntityProperty', 'call'> {
  return { id: 'tool-1', name: 'SetEntityProperty', data };
}

afterEach(cleanup);

describe('BulkSetEntityPropertyOptions renderer', () => {
  it('renders the affected-item count and a colored tag chip', () => {
    const { container } = renderTool(
      bulkSetEntityPropertyOptionsHandler,
      bulkTool({
        property_definition_id: TAG_DEF,
        add_option_ids: ['opt-follow'],
        entities: Array.from({ length: 18 }, (_, i) => ({
          entity_id: `doc-${i}`,
          entity_type: 'document',
        })),
      })
    );

    expect(container.textContent).toContain('Tag');
    expect(container.textContent).toContain('18 items');
    expect(container.textContent).toContain('Follow-up');

    const dot = container.querySelector('span[style*="background-color"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.backgroundColor).toBe('rgb(220, 38, 38)');
  });

  it('singularizes the item count', () => {
    const { container } = renderTool(
      bulkSetEntityPropertyOptionsHandler,
      bulkTool({
        property_definition_id: TAG_DEF,
        add_option_ids: ['opt-follow'],
        entities: [{ entity_id: 'doc-0', entity_type: 'document' }],
      })
    );

    expect(container.textContent).toContain('1 item');
    expect(container.textContent).not.toContain('1 items');
  });
});

describe('SetEntityProperty renderer', () => {
  it('renders a tag add as a colored chip', () => {
    const { container } = renderTool(
      setEntityPropertyHandler,
      setTool({
        entity_type: 'document',
        entity_id: 'entity-1',
        property_definition_id: TAG_DEF,
        add_option_ids: ['opt-follow'],
      })
    );

    expect(container.textContent).toContain('Tag');
    expect(container.textContent).toContain('document');
    expect(container.textContent).toContain('Follow-up');
  });

  it('renders a tag removal as a struck-through chip labelled Untag', () => {
    const { container } = renderTool(
      setEntityPropertyHandler,
      setTool({
        entity_type: 'document',
        entity_id: 'entity-1',
        property_definition_id: TAG_DEF,
        remove_option_ids: ['opt-urgent'],
      })
    );

    expect(container.textContent).toContain('Untag');
    const struck = container.querySelector('.line-through');
    expect(struck).not.toBeNull();
    expect(struck?.textContent).toContain('Urgent');
  });

  it('resolves a non-tag select value (Status) to a colored chip', () => {
    const { container } = renderTool(
      setEntityPropertyHandler,
      setTool({
        entity_type: 'document',
        entity_id: 'entity-1',
        property_definition_id: STATUS_DEF,
        option_id: 'status-done',
      })
    );

    expect(container.textContent).toContain('Set');
    expect(container.textContent).toContain('document');
    expect(container.textContent).toContain('Done');

    const dot = container.querySelector('span[style*="background-color"]');
    expect((dot as HTMLElement).style.backgroundColor).toBe(
      'rgb(16, 185, 129)'
    );
  });

  it('renders a literal string value', () => {
    const { container } = renderTool(
      setEntityPropertyHandler,
      setTool({
        entity_type: 'document',
        entity_id: 'entity-1',
        property_definition_id: 'notes-def',
        string_value: 'Draft copy',
      })
    );

    expect(container.textContent).toContain('Set');
    expect(container.textContent).toContain('Draft copy');
  });

  it('falls back to a bare label when no option resolves', () => {
    const { container } = renderTool(
      setEntityPropertyHandler,
      setTool({
        entity_type: 'company',
        entity_id: 'entity-1',
        property_definition_id: 'empty-def',
        add_option_ids: ['ghost-option'],
      })
    );

    expect(container.textContent).toContain('Update property on');
    expect(container.textContent).toContain('company');
  });
});
