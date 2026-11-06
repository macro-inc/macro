import type { PropertyDefinitionDomain } from '@property/types';
import type { TaskTemplateConfiguration } from '@service-storage/generated/schemas/taskTemplateConfiguration';
import { expect, it } from 'vitest';
import { fillTaskTemplate } from '../core/template';
import {
  isConfirmedTemplateUpdate,
  taskTemplateConfiguration,
  taskTemplateContents,
} from './template-mapping';

const definition: PropertyDefinitionDomain = {
  id: '0198a4cc-e138-7670-a308-a6b766602730',
  displayName: 'Effort',
  valueType: 'NUMBER',
  isMultiSelect: false,
  isMetadata: false,
  isSystem: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

it('preserves inaccessible fields during edits while honoring removal of accessible fields', () => {
  const previous: TaskTemplateConfiguration = {
    propertyIds: [definition.id, '0198a4cc-e138-7670-a308-a6b766602731'],
    defaults: [
      { propertyId: definition.id, value: { type: 'number', value: 0 } },
      {
        propertyId: '0198a4cc-e138-7670-a308-a6b766602731',
        value: { type: 'boolean', value: false },
      },
    ],
    descriptionMarkdown: '',
  };
  expect(
    taskTemplateConfiguration(
      {
        propertyIds: [],
        propertyDefaults: {},
        descriptionMarkdown: 'Updated description',
      },
      [definition],
      previous
    )
  ).toEqual({
    propertyIds: ['0198a4cc-e138-7670-a308-a6b766602731'],
    defaults: [
      {
        propertyId: '0198a4cc-e138-7670-a308-a6b766602731',
        value: { type: 'boolean', value: false },
      },
    ],
    descriptionMarkdown: 'Updated description',
  });
});

it('leaves a changed property blank and does not apply a deleted definition', () => {
  const contents = taskTemplateContents(
    {
      propertyIds: [definition.id, '0198a4cc-e138-7670-a308-a6b766602731'],
      defaults: [
        {
          propertyId: definition.id,
          value: { type: 'string', value: 'Old text default' },
        },
        {
          propertyId: '0198a4cc-e138-7670-a308-a6b766602731',
          value: { type: 'number', value: 12 },
        },
      ],
      descriptionMarkdown: '- [ ] Details',
    },
    [definition]
  );
  const applied = fillTaskTemplate(
    { propertyIds: [], propertyDefaults: {}, descriptionMarkdown: '' },
    contents,
    new Set([definition.id])
  );
  expect(applied.propertyIds).toEqual([definition.id]);
  expect(applied.propertyDefaults).toEqual({});
});

it('confirms exactly one lost update response only for matching content, owner and permission', () => {
  const original = {
    id: 'template',
    name: 'Before',
    teamId: null,
    revision: 4,
    contents: {
      propertyIds: ['due'],
      propertyDefaults: {},
      descriptionMarkdown: '',
    },
  };
  const request = {
    propertyIds: ['due', 'unavailable'],
    descriptionMarkdown: 'After',
    defaults: [
      {
        propertyId: 'due',
        value: { type: 'date' as const, value: '2026-10-22T00:00:00.000Z' },
      },
      {
        propertyId: 'unavailable',
        value: { type: 'string' as const, value: 'keep' },
      },
    ],
  };
  const observed = {
    id: 'template',
    revision: 5,
    name: 'After',
    teamId: null,
    userId: 'viewer',
    canManage: true,
    creatorId: 'viewer',
    createdAt: '',
    updatedAt: '',
    configuration: {
      ...request,
      defaults: [
        request.defaults[1],
        {
          propertyId: 'due',
          value: { type: 'date' as const, value: '2026-10-22T00:00:00Z' },
        },
      ],
    },
  };
  expect(
    isConfirmedTemplateUpdate(observed, original, 'viewer', 'After', request)
  ).toBe(true);
  expect(
    isConfirmedTemplateUpdate(
      { ...observed, canManage: false },
      original,
      'viewer',
      'After',
      request
    )
  ).toBe(false);
  expect(
    isConfirmedTemplateUpdate(
      { ...observed, userId: 'other' },
      original,
      'viewer',
      'After',
      request
    )
  ).toBe(false);
  expect(
    isConfirmedTemplateUpdate(
      { ...observed, name: 'Other' },
      original,
      'viewer',
      'After',
      request
    )
  ).toBe(false);
  expect(
    isConfirmedTemplateUpdate(
      { ...observed, revision: 6 },
      original,
      'viewer',
      'After',
      request
    )
  ).toBe(false);
  expect(
    isConfirmedTemplateUpdate(
      {
        ...observed,
        configuration: { ...request, descriptionMarkdown: 'Different' },
      },
      original,
      'viewer',
      'After',
      request
    )
  ).toBe(false);
});
