import { extractLinkPreviewUrlsFromMarkdown } from '@macro-inc/lexical-core/utils/link-previews';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const linkPreviewsRequest = z.object({
  markdown: z.string(),
});

const linkPreviewsResponse = z.object({
  urls: z.array(z.string()),
});

export class LinkPreviewsEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Find the links that get preview cards',
    description:
      'Parses a macro markdown string as Lexical editor state and returns the web links a rendered channel message shows preview cards for, in text order.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: linkPreviewsRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'The previewable link URLs',
        content: {
          'application/json': {
            schema: linkPreviewsResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      const urls = extractLinkPreviewUrlsFromMarkdown(body.markdown);
      return c.json({ urls });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
