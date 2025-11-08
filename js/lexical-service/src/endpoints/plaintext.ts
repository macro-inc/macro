import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { toPlaintext } from "../lib/convsersions";
import {
  ConversionError,
  createSyncError,
  handleEndpointError,
  validateEnvironment
} from "../lib/error-handler";
import { docIdParam, standardErrorResponses } from "../lib/schemas";
import { createSyncClient } from "../lib/sync-service";

export class PlaintextEndpoint extends OpenAPIRoute {
  schema = {
    summary: "Convert document snapshot to plain text",
    description: "Fetches a document snapshot from the sync service and converts it to plain text using Lexical editor state parsing",
    request: {
      params: docIdParam,
    },
    responses: {
      200: {
        description: "Successfully converted document to plain text",
        content: {
          "application/json": {
            schema: z.object({
              data: z.string()
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
          const text = toPlaintext(rawDocument.data);
          return c.json({ data: text });
        } catch {
          throw new ConversionError('Failed to parse document snapshot');
        }
      } else {
        throw createSyncError(rawDocument as { success: false; error: Error; status?: number });
      }
    } catch (error) {
      return handleEndpointError(error, c, docId);
    }
  }
}
