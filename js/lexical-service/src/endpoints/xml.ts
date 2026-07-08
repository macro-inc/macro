import { toXml } from '@macro-inc/lexical-core';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  ConversionError,
  createSyncError,
  handleEndpointError,
  validateEnvironment,
} from '../lib/error-handler';
import { docIdParam, standardErrorResponses } from '../lib/schemas';
import { createSyncClient } from '../lib/sync-service';

export class XmlEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert document snapshot to XML',
    description:
      'Fetches a document snapshot from the sync service and converts it to XML',
    request: {
      params: docIdParam,
    },
    responses: {
      200: {
        description: 'Successfully converted document to XML',
        content: {
          'application/json': {
            schema: z.object({
              data: z.string(),
            }),
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
          const xml = toXml(rawDocument.data);
          return c.json({ data: xml });
        } catch {
          throw new ConversionError('Failed to parse document snapshot');
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
