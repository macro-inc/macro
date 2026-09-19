import type { Property } from '@property/types';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const propertiesQuery = vi.hoisted(() => vi.fn());
const accessQuery = vi.hoisted(() => vi.fn());
vi.mock('@property/hooks', () => ({ useEntityProperties: propertiesQuery }));
vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentAccessLevelQuery: accessQuery,
}));
vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>avatar</span>,
}));
vi.mock('@property/component/propertyValue/PropertyValueIcon', () => ({
  PropertyValueIcon: (props: { optionId: string }) => (
    <span>{props.optionId}</span>
  ),
}));
vi.mock('@block-md/component/InlinePropertyValue', () => ({
  InlinePropertyValue: (props: { property: Property }) => (
    <span>{props.property.displayName}</span>
  ),
}));
vi.mock('@core/component/SharePermissions', () => ({
  getPermissions: (value: unknown) => value,
  hasPermissions: () => false,
  Permissions: { CAN_EDIT: 1 },
}));
vi.mock('@property/component/modal', () => ({ Modals: () => null }));
vi.mock('@property/context/PropertiesContext', () => ({
  PropertiesProvider: (props: {
    canEdit: boolean;
    children: import('solid-js').JSX.Element;
  }) => (
    <section data-can-edit={String(props.canEdit)}>{props.children}</section>
  ),
}));

import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { InlineTaskProperties } from './InlineTaskProperties';
import { TaskPropertiesPreview } from './TaskPropertiesPreview';

beforeEach(() => {
  vi.clearAllMocks();
  propertiesQuery.mockReturnValue({
    properties: () => [],
    isLoading: () => false,
    refetch: vi.fn(),
  });
  accessQuery.mockReturnValue({ isSuccess: true, data: 'view' });
});

const status = {
  propertyId: 'assignment',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
  displayName: 'Status',
  valueType: 'SELECT_STRING',
  value: ['status-1'],
  isMultiSelect: false,
} as Property;

describe('task preview data ownership', () => {
  it('never mounts child queries for pending or loaded GraphQL edges', () => {
    const [metadata, setMetadata] = createSignal<PreviewDocumentProperties>({
      properties: undefined,
      canEdit: false,
      refetch: vi.fn(async () => {}),
    });
    const view = render(() => (
      <>
        <InlineTaskProperties taskId="task" previewProperties={metadata()} />
        <TaskPropertiesPreview taskId="task" previewProperties={metadata()} />
      </>
    ));
    try {
      expect(propertiesQuery).not.toHaveBeenCalled();
      expect(accessQuery).not.toHaveBeenCalled();
      setMetadata((old) => ({ ...old, properties: [], canEdit: false }));
      expect(view.container.textContent).toBe('');
      setMetadata((old) => ({ ...old, properties: [status], canEdit: true }));
      expect(view.container.textContent).toContain('status-1');
      expect(view.container.querySelector('section')?.dataset.canEdit).toBe(
        'true'
      );
      // A live property write and permission change flow through without a refetch.
      setMetadata((old) => ({
        ...old,
        properties: [{ ...status, value: ['status-2'] } as Property],
        canEdit: false,
      }));
      expect(view.container.textContent).toContain('status-2');
      expect(view.container.textContent).not.toContain('status-1');
      expect(view.container.querySelector('section')?.dataset.canEdit).toBe(
        'false'
      );
      expect(propertiesQuery).not.toHaveBeenCalled();
      expect(accessQuery).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('retains standalone/REST fallback queries', () => {
    const view = render(() => (
      <>
        <InlineTaskProperties taskId="task" />
        <TaskPropertiesPreview taskId="task" />
      </>
    ));
    try {
      expect(propertiesQuery).toHaveBeenCalledTimes(2);
      expect(accessQuery).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });
});
