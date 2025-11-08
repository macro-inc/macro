import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { toSearchText } from "../lib/convsersions";
import { createSyncClient } from "../lib/sync-service";
import {
  handleEndpointError,
  createSyncError,
  validateEnvironment,
  ConversionError
} from "../lib/error-handler";
import { standardErrorResponses, docIdParam, searchableNodeSchema } from "../lib/schemas";

export class SearchTextEndpoint extends OpenAPIRoute {
  schema = {
    summary: "Convert document snapshot to searchable text",
    description: "Fetches a document snapshot from the sync service and converts it to searchable text with node metadata using Lexical editor state parsing",
    request: {
      params: docIdParam,
    },
    responses: {
      200: {
        description: "Successfully converted document to searchable text",
        content: {
          "application/json": {
            schema: z.object({
              data: z.array(searchableNodeSchema)
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
          const searchableNodes = toSearchText(rawDocument.data);
          return c.json({ data: searchableNodes });
        } catch {
          throw new ConversionError('Failed to parse document snapshot for search text');
        }
      } else {
        throw createSyncError(rawDocument as { success: false; error: Error; status?: number });
      }
    } catch (error) {
      return handleEndpointError(error, c, docId);
    }
  }
}
