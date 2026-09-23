import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { toCommentMarkContext } from '../lib/convsersions';
import {
  ConversionError,
  createSyncError,
  handleEndpointError,
  validateEnvironment,
} from '../lib/error-handler';
import { docIdParam, standardErrorResponses } from '../lib/schemas';
import { createSyncClient } from '../lib/sync-service';

const commentMarkContext = z.object({
  markedText: z.string(),
  surroundingText: z.string(),
});

export class CommentMarkEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Resolve a comment mark to the text it covers',
    description:
      'Reads the live document from the sync service and returns the text a comment mark covers with a bounded window of its surrounding blocks, or null when the document no longer carries the mark. Callers must have checked access to the document.',
    request: {
      params: docIdParam.extend({
        markId: z.string().min(1, 'Mark ID is required'),
      }),
    },
    responses: {
      200: {
        description: 'The mark, or null when it is no longer in the document',
        content: {
          'application/json': {
            schema: z.object({ data: commentMarkContext.nullable() }),
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
      if (!rawDocument.success) {
        throw createSyncError(
          rawDocument as { success: false; error: Error; status?: number }
        );
      }
      try {
        return c.json({
          data: toCommentMarkContext(rawDocument.data, params.markId),
        });
      } catch {
        throw new ConversionError('Failed to parse document snapshot');
      }
    } catch (error) {
      return handleEndpointError(error, c, docId);
    }
  }
}
