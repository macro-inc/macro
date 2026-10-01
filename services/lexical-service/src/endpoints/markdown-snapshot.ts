import { markdownToAutomergeSnapshot } from '@macro-inc/lexical-core/markdown-automerge-snapshot';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { ConversionError, handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const markdownSnapshotRequest = z.object({
  markdown: z.string(),
});

export class MarkdownSnapshotEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert markdown to an Automerge snapshot',
    description:
      'Converts a markdown string to Lexical editor state, assigns durable node ids, mirrors it into Automerge, and returns an Automerge snapshot.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: markdownSnapshotRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully converted markdown to an Automerge snapshot',
        content: {
          'application/octet-stream': {
            schema: z.any(),
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      const snapshot = await markdownToAutomergeSnapshot(body.markdown);

      if (!snapshot) {
        throw new ConversionError(
          'Failed to create Automerge snapshot from markdown'
        );
      }

      return c.body(new Uint8Array(snapshot), 200, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
