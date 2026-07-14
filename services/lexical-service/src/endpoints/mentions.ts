import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';
import { extractChannelMentionsFromMarkdown } from '@macro-inc/lexical-core/utils/markdown-mentions';

const mentionsRequest = z.object({
  markdown: z.string(),
});

const mentionsResponse = z.object({
  mentions: z.array(
    z.object({
      entityType: z.string(),
      entityId: z.string(),
    })
  ),
});

export class MentionsEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Extract mentions from markdown',
    description:
      'Parses a macro markdown string as Lexical editor state and returns the entity mentions it contains, in the shape channel messages track them.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: mentionsRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully extracted mentions',
        content: {
          'application/json': {
            schema: mentionsResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      const mentions = extractChannelMentionsFromMarkdown(body.markdown);
      return c.json({ mentions });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
