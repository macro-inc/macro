import { notionMarkdownToLoroSnapshot } from '@macro-inc/lexical-core/notion-markdown';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const notionSnapshotRequest = z.object({
  markdown: z.string(),
  links: z.object({
    pages: z.record(
      z.string(),
      z.object({ documentId: z.string(), name: z.string() })
    ),
    users: z.record(
      z.string(),
      z.object({ userId: z.string(), email: z.string() })
    ),
  }),
});

const notionSnapshotResponse = z.object({
  snapshot: z.string().describe('The Loro snapshot, base64-encoded'),
  markdown: z.string().describe('The same content as Macro markdown'),
});

export class NotionSnapshotEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert Notion markdown to a Loro snapshot',
    description:
      "Converts a page in Notion's enhanced markdown to Lexical nodes, resolving page and people references through `links` (keyed by dashless Notion id) into document and user mentions, assigns durable node ids, and returns the Loro snapshot with the same content as Macro markdown.",
    request: {
      body: {
        content: {
          'application/json': {
            schema: notionSnapshotRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully converted Notion markdown',
        content: {
          'application/json': {
            schema: notionSnapshotResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    // Validated outside the try so a bad body answers 400, not 500.
    const { body } = await this.getValidatedData<typeof this.schema>();
    try {
      const { snapshot, markdown } = await notionMarkdownToLoroSnapshot(
        body.markdown,
        body.links
      );
      return c.json({
        snapshot: Buffer.from(snapshot).toString('base64'),
        markdown,
      });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
