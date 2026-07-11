import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import type { SerializedEditorState } from 'lexical';
import { z } from 'zod';
import { toCognitionText } from '../lib/convsersions';
import { ConversionError, handleEndpointError } from '../lib/error-handler';
import { cognitionNodeSchema, standardErrorResponses } from '../lib/schemas';
import type { CognitionNode } from '../types';

export class CognitionPresignedEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Convert content from presigned URL to cognition text',
    description:
      'Downloads content from a presigned URL and converts it to cognition text. Attempts to parse as Lexical JSON, falls back to plain markdown.',
    request: {
      query: z.object({
        url: z.string().url('A valid presigned URL is required'),
      }),
    },
    responses: {
      200: {
        description: 'Successfully converted content to cognition text',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(cognitionNodeSchema),
            }),
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    let presignedUrl = 'unknown';
    try {
      const { query } = await this.getValidatedData<typeof this.schema>();
      presignedUrl = query.url;

      const response = await fetch(presignedUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new ConversionError(
          `Failed to download content: ${response.status} ${response.statusText}`
        );
      }

      const contentText = await response.text();

      // Try to parse as Lexical JSON first
      try {
        const lexicalData = JSON.parse(contentText) as SerializedEditorState;
        // Validate it looks like Lexical editor state
        if (lexicalData.root && lexicalData.root.children) {
          const cognitionNodes = toCognitionText(lexicalData);
          return c.json({ data: cognitionNodes });
        }
      } catch {
        // Not valid Lexical JSON, fall through to plain markdown handling
      }

      // Treat as plain markdown - return as single node
      const plainMarkdownNode: CognitionNode = {
        nodeId: 'plain-text',
        content: contentText,
        rawContent: contentText,
        type: 'markdown',
      };

      return c.json({ data: [plainMarkdownNode] });
    } catch (error) {
      return handleEndpointError(error, c, `presigned:${presignedUrl}`);
    }
  }
}
