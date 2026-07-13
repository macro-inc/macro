import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { toCognitionV2 } from '../lib/convsersions';
import {
  ConversionError,
  createSyncError,
  handleEndpointError,
  validateEnvironment,
} from '../lib/error-handler';
import { docIdParam, standardErrorResponses } from '../lib/schemas';
import { createSyncClient } from '../lib/sync-service';

const newMdNodeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('generic'),
    nodeId: z.string(),
    content: z.string(),
    tag: z.string(),
  }),
  z.object({
    type: z.literal('staticImage'),
    url: z.string(),
  }),
  z.object({
    type: z.literal('dssImage'),
    id: z.string(),
  }),
]);

export class CognitionV2Endpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert document snapshot to structured cognition nodes (v2)',
    description:
      'Fetches a document snapshot and converts it to typed nodes including images and generic content nodes',
    request: {
      params: docIdParam,
    },
    responses: {
      200: {
        description: 'Successfully converted document to cognition v2 nodes',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(newMdNodeSchema) }),
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    let docId = 'unknown';
    try {
      const { params } = await this.getValidatedData<typeof this.schema>();
      docId = params.docId;

      validateEnvironment(c, ['SYNC_SERVICE_AUTH_KEY', 'SYNC_SERVICE_URL']);

      const syncClient = createSyncClient({
        baseUrl: c.env.SYNC_SERVICE_URL,
        internalAuthKey: c.env.SYNC_SERVICE_AUTH_KEY,
        serviceFetcher: c.env.SYNC_SERVICE,
      });

      const rawDocument = await syncClient.raw(docId);

      if (rawDocument.success) {
        try {
          const nodes = toCognitionV2(rawDocument.data);
          return c.json({ data: nodes });
        } catch {
          throw new ConversionError(
            'Failed to parse document snapshot for cognition v2'
          );
        }
      } else {
        throw createSyncError(
          rawDocument as { success: false; error: Error; status?: number }
        );
      }
    } catch (error) {
      return handleEndpointError(error, c, docId);
    }
  }
}
