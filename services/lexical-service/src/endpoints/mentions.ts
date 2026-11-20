import { extractChannelMentionsFromMarkdown } from '@macro-inc/lexical-core/utils/markdown-mentions';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const mentionsRequest = z.object({
  markdown: z.string(),
  // The environment's web app origin: links to Macro entities on it count as
  // mentions, as they do when a document is created. Channel messages omit it.
  appOrigin: z.string().optional(),
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
      const mentions = extractChannelMentionsFromMarkdown(body.markdown, {
        appOrigin: body.appOrigin,
      });
      return c.json({ mentions });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
