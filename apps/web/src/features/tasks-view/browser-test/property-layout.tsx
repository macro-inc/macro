import '@app/index.css';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { Property } from '@property/types';
import { For } from 'solid-js';
import { render } from 'solid-js/web';

// Static values exercise the real cell, tooltip, and text wrappers without
// depending on hosted users, project permissions, or network requests.
const properties: Property[] = ['select', 'inline'].map((id) => ({
  propertyId: id,
  propertyDefinitionId: id,
  displayName: id,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...(id === 'select'
    ? {
        valueType: 'SELECT_STRING' as const,
        value: ['long-label'],
        options: [
          {
            id: 'long-label',
            property_definition_id: id,
            color: 'default' as const,
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
            display_order: 0,
            value: {
              type: 'string' as const,
              value:
                'A very long property value that must stay inside its column',
            },
          },
        ],
      }
    : {
        valueType: 'STRING' as const,
        value:
          'Another very long property value that must not cover its neighbor',
      }),
}));

render(
  () => (
    <main class="p-8 text-ink bg-page min-h-screen">
      <h1>Property cell layout regression</h1>
      <PropertiesProvider
        entityId="layout-fixture"
        entityType="TASK"
        canEdit={false}
        properties={() => properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={{
          saveProperty: async () => {},
          saveDate: async () => {},
        }}
      >
        <div
          class="grid gap-2 text-xs"
          style={{ 'grid-template-columns': '9rem 8rem 8rem' }}
        >
          <For each={properties}>
            {(property) => (
              <div
                class="flex min-w-0 items-center"
                data-testid="property-cell"
              >
                <ListPropertyValue
                  entityId="layout-fixture"
                  property={property}
                />
              </div>
            )}
          </For>
          <div>Neighbor column</div>
        </div>
      </PropertiesProvider>
    </main>
  ),
  document.querySelector('#root')!
);
