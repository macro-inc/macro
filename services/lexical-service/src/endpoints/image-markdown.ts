import { composeImageMarkdown } from '@macro-inc/lexical-core/utils/image-markdown';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

export class ImageMarkdownEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Compose channel image markdown with intrinsic dimensions',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              staticFileId: z.string().uuid(),
              url: z.string().url(),
              width: z.number().int().positive().max(4294967295),
              height: z.number().int().positive().max(4294967295),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Image markdown serialized from a Lexical image node',
        content: {
          'application/json': { schema: z.object({ markdown: z.string() }) },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    try {
      return c.json({ markdown: composeImageMarkdown(body) });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
