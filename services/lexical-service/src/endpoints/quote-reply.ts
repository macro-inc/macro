import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';
import { isQuoteReplyMarkdown } from '@macro-inc/lexical-core/utils/quote-reply';

const quoteReplyRequest = z.object({
  markdown: z.string(),
});

const quoteReplyResponse = z.object({
  isQuoteReply: z.boolean(),
});

export class QuoteReplyEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Detect whether markdown is a quote-reply',
    description:
      'Parses a macro markdown string as Lexical editor state and reports whether it is composed as a quote-reply: a leading blockquote quoting the replied-to message, followed by the reply itself.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: quoteReplyRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully evaluated the markdown',
        content: {
          'application/json': {
            schema: quoteReplyResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      return c.json({ isQuoteReply: isQuoteReplyMarkdown(body.markdown) });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
