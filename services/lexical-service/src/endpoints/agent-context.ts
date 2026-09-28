import { composeAgentContextPrompt } from '@macro-inc/lexical-core/utils/agent-context';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const messageParent = z.object({
  type: z.enum(['channel', 'document']),
  id: z.string().min(1),
});

const commentAnchor = z.union([
  z.object({
    type: z.literal('markdown').optional(),
    markId: z.string().min(1),
    markedText: z.string().optional(),
    currentMarkedText: z.string().optional(),
    surroundingText: z.string().optional(),
  }),
  z.object({
    type: z.literal('pdfHighlight'),
    anchorId: z.string().min(1),
    markedText: z.string().optional(),
  }),
  z.object({
    type: z.literal('pdfPin'),
    anchorId: z.string().min(1),
  }),
]);

const contextMessage = z.object({
  id: z.string().min(1),
  senderId: z.string(),
  author: z.string(),
  content: z.string(),
  postedAt: z.string(),
});

const contextThread = z.object({
  rootId: z.string().min(1),
  messages: z.array(contextMessage),
  messagesOmitted: z.boolean(),
});

const replyTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote'),
    messageId: z.string().min(1),
    threadId: z.string().min(1),
    preview: z.string(),
    message: contextMessage.optional(),
  }),
  z.object({
    kind: z.literal('thread'),
    threadId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('none'),
  }),
]);

const agentContextRequest = z.object({
  promptMarkdown: z.string(),
  parent: messageParent.optional(),
  anchor: commentAnchor.optional(),
  replyTarget: replyTarget.optional(),
  promptMessageId: z.string().min(1).optional(),
  thread: contextThread.optional(),
  channel: z.array(contextThread).optional(),
});

const agentContextResponse = z.object({
  markdown: z.string(),
});

export class AgentContextEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Compose an agent prompt with conversation context',
    description:
      'Builds internal markdown containing the conversation the prompt was posted in - its thread, the channel around it, what it replies to, and the comment anchor it sits on - followed by the user prompt.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: agentContextRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully composed the agent context markdown',
        content: {
          'application/json': {
            schema: agentContextResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      const markdown = composeAgentContextPrompt(body);
      return c.json({ markdown });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
