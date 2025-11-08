import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { toMarkdownText } from '../lib/convsersions';
import {
  ConversionError,
  createSyncError,
  handleEndpointError,
  validateEnvironment,
} from '../lib/error-handler';
import { docIdParam, standardErrorResponses } from '../lib/schemas';
import { createSyncClient } from '../lib/sync-service';

export class MarkdownEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert document snapshot to markdown',
    description:
      'Fetches a document snapshot from the sync service and converts it to markdown using Lexical editor state parsing',
    request: {
      params: docIdParam,
      query: z.object({
        target: z.enum(['internal', 'external']).optional().default('internal'),
      }),
    },
    responses: {
      200: {
        description: 'Successfully converted document to markdown',
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
      const { params, query } =
        await this.getValidatedData<typeof this.schema>();
      docId = params.docId;
      const target = query.target;

      validateEnvironment(c, ['SYNC_SERVICE_AUTH_KEY', 'SYNC_SERVICE_URL']);

      const syncClient = createSyncClient({
        baseUrl: c.env.SYNC_SERVICE_URL,
        internalAuthKey: c.env.SYNC_SERVICE_AUTH_KEY,
        serviceFetcher: c.env.SYNC_SERVICE,
      });

      const rawDocument = await syncClient.raw(docId);

      if (rawDocument.success) {
        try {
          const markdown = toMarkdownText(rawDocument.data, target);
          return c.json({ data: markdown });
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
