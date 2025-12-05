import {
  asRawShape,
  fetchErrorsSvc,
  Svc,
  withFetchErrors,
} from '@core/service';
import { z } from 'zod';
import * as schemas from './generated/zod';

export const PropertiesService = new Svc(
  'Properties Service - Manages document metadata and properties'
)
  .use('fetchErrors', fetchErrorsSvc)
  .fn('listProperties', {
    description: schemas.listPropertiesQueryParams.description!,
    args: schemas.listPropertiesQueryParams.shape,
    result: asRawShape(schemas.listPropertiesResponse),
    throws: withFetchErrors(),
  })
  .fn('createPropertyDefinition', {
    description: schemas.createPropertyDefinitionBody.description!,
    modifies: true,
    args: {
      body: schemas.createPropertyDefinitionBody,
    },
    result: asRawShape(
      z
        .object({
          created_at: z.string().datetime(),
          data_type: z.enum([
            'boolean',
            'date',
            'number',
            'string',
            'select_number',
            'select_string',
            'entity',
          ]),
          display_name: z.string(),
          id: z.string().uuid(),
          is_metadata: z.boolean(),
          is_multi_select: z.boolean(),
          owner: z.union([
            z.object({ scope: z.enum(['user']), user_id: z.string() }),
            z.object({
              scope: z.enum(['organization']),
              organization_id: z.number(),
            }),
            z.object({
              scope: z.enum(['user_and_organization']),
              user_id: z.string(),
              organization_id: z.number(),
            }),
          ]),
          specific_entity_type: z
            .enum(['channel', 'chat', 'document', 'project', 'thread', 'user'])
            .nullable()
            .optional(),
          updated_at: z.string().datetime(),
        })
        .describe('Property definition model (service representation).')
    ),
    throws: withFetchErrors(),
  })
  .fn('deletePropertyDefinition', {
    description: schemas.deletePropertyDefinitionParams.description!,
    modifies: true,
    args: schemas.deletePropertyDefinitionParams.shape,
    result: asRawShape(z.object({ success: z.boolean() })),
    throws: withFetchErrors(),
  })
  .fn('getEntityProperties', {
    description:
      schemas.getEntityPropertiesParams.description ||
      'Get all properties for an entity',
    args: {
      entity_type: z.enum([
        'CHANNEL',
        'CHAT',
        'DOCUMENT',
        'PROJECT',
        'THREAD',
        'USER',
      ]),
      entity_id: z.string(),
      query: z.object({
        include_metadata: z.boolean().optional(),
      }),
    },
    result: asRawShape(schemas.getEntityPropertiesResponse),
    throws: withFetchErrors(),
  })
  .fn('setEntityProperty', {
    description:
      schemas.setEntityPropertyParams.description ||
      'Set or update a property value for an entity',
    modifies: true,
    args: {
      entity_type: z.enum([
        'CHANNEL',
        'CHAT',
        'DOCUMENT',
        'PROJECT',
        'THREAD',
        'USER',
      ]),
      entity_id: z.string(),
      property_id: z.string().uuid(),
      body: schemas.setEntityPropertyBody,
    },
    result: asRawShape(z.object({ success: z.boolean() })),
    throws: withFetchErrors(),
  })
  .fn('deleteEntityProperty', {
    description: schemas.deleteEntityPropertyParams.description!,
    modifies: true,
    args: schemas.deleteEntityPropertyParams.shape,
    result: asRawShape(z.object({ success: z.boolean() })),
    throws: withFetchErrors(),
  })
  .fn('getPropertyOptions', {
    description: schemas.getPropertyOptionsParams.description!,
    args: schemas.getPropertyOptionsParams.shape,
    result: asRawShape(schemas.getPropertyOptionsResponse),
    throws: withFetchErrors(),
  })
  .fn('addPropertyOption', {
    description: schemas.addPropertyOptionParams.description!,
    modifies: true,
    args: {
      ...schemas.addPropertyOptionParams.shape,
      body: schemas.addPropertyOptionBody,
    },
    result: asRawShape(
      z
        .object({
          created_at: z.string().datetime(),
          display_order: z.number(),
          id: z.string().uuid(),
          property_definition_id: z.string().uuid(),
          updated_at: z.string().datetime(),
          value: z.union([
            z.object({
              type: z.enum(['string']),
              value: z.string(),
            }),
            z.object({
              type: z.enum(['number']),
              value: z.number(),
            }),
          ]),
        })
        .describe(
          'A selectable option for select-type properties (service representation).'
        )
    ),
    throws: withFetchErrors(),
  })
  .fn('deletePropertyOption', {
    description: schemas.deletePropertyOptionParams.description!,
    modifies: true,
    args: schemas.deletePropertyOptionParams.shape,
    result: asRawShape(z.object({ success: z.boolean() })),
    throws: withFetchErrors(),
  });

export type PropertiesService = typeof PropertiesService;
