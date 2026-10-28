import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import type { SerializedEditorState } from 'lexical';
import { z } from 'zod';
import { isCommentOnlyChange } from '../lib/comment-only-change';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const editorState = z.object({ root: z.object({}).passthrough() });

const commentOnlyChangeRequest = z.object({
  before: editorState,
  after: editorState,
});

export class CommentOnlyChangeEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Check that a document change only touches comment marks',
    description:
      'Compares two Lexical editor states of one document and reports whether they differ only in comment marks. The sync service asks this before accepting an update from a session that may comment but not edit.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: commentOnlyChangeRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Whether the change only touches comment marks',
        content: {
          'application/json': {
            schema: z.object({ commentOnly: z.boolean() }),
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      return c.json({
        commentOnly: isCommentOnlyChange(
          body.before as unknown as SerializedEditorState,
          body.after as unknown as SerializedEditorState
        ),
      });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
