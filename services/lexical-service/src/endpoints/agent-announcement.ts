import { CONNECT_APP_TARGETS } from '@macro-inc/lexical-core/nodes/ConnectAppNode';
import {
  MAGIC_CHIP_AUTHORS,
  MAGIC_CHIP_STATUSES,
} from '@macro-inc/lexical-core/nodes/MagicChipNode';
import type { ReplyTargetParent } from '@macro-inc/lexical-core/nodes/ReplyTargetNode';
import { composeAgentSessionAnnouncement } from '@macro-inc/lexical-core/utils/agent-announcement';
import { composeAgentChatReply } from '@macro-inc/lexical-core/utils/agent-chat-reply';
import { composeAgentConnectionPrompt } from '@macro-inc/lexical-core/utils/agent-connection-prompt';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const messageParent = z.object({
  type: z.enum(['channel', 'document']),
  id: z.string().min(1),
});

const replyTargetRequest = z
  .object({
    parent: messageParent.optional(),
    channelId: z.string().optional(),
    targetMessageId: z.string(),
    targetThreadId: z.string(),
    displayText: z.string(),
    senderId: z.string(),
  })
  .refine(
    (target) => target.parent !== undefined || target.channelId !== undefined,
    {
      message: 'replyTarget needs a parent or a channelId',
    }
  );

const sessionAnnouncementRequest = z.object({
  replyTarget: replyTargetRequest,
  chip: z.object({
    agentSessionId: z.string(),
    channelId: z.string().optional(),
    promptedMessage: z.object({
      turn: z.number().int().nonnegative(),
      author: z.enum(MAGIC_CHIP_AUTHORS),
    }),
    status: z.enum(MAGIC_CHIP_STATUSES),
  }),
});

/**
 * A chat agent's thread message in one of its states: the spinner while its
 * turn runs, or prose the harness patches in - the answer, a fallback for a
 * turn that said nothing, a question only the session view can answer.
 */
const chatReplyRequest = z.object({
  chatReply: z.object({
    sessionId: z.string().min(1),
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pending') }),
      z.object({ kind: z.literal('markdown'), markdown: z.string() }),
    ]),
  }),
});

const agentAnnouncementRequest = z.union([
  sessionAnnouncementRequest,
  chatReplyRequest,
  z.object({
    connectionPrompt: z.object({
      agentTag: z.string().min(1),
      message: z.string().min(1),
      chip: z.object({
        appSlug: z.string().regex(/^[a-z0-9_-]+$/),
        name: z.string().min(1),
        target: z.enum(CONNECT_APP_TARGETS),
      }),
    }),
  }),
]);

const agentAnnouncementResponse = z.object({
  markdown: z.string(),
});

export class AgentAnnouncementEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Compose an agent-harness bot response',
    description:
      'Builds an agent announcement, a chat agent reply, or a connection prompt from structured Lexical nodes.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: agentAnnouncementRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successfully composed the announcement markdown',
        content: {
          'application/json': {
            schema: agentAnnouncementResponse,
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    try {
      if ('connectionPrompt' in body) {
        return c.json({
          markdown: composeAgentConnectionPrompt(body.connectionPrompt),
        });
      }
      if ('chatReply' in body) {
        const { sessionId, body: replyBody } = body.chatReply;
        // The schema requires a body, but the discriminated union does not
        // survive chanfana's OpenAPI round-trip as required, so it arrives
        // typed as optional. Refuse rather than invent a state: a reply with
        // no body is a caller bug, and guessing one would post it to a thread.
        if (!replyBody) {
          throw new Error('chatReply needs a body');
        }
        return c.json({
          markdown: composeAgentChatReply({ sessionId, body: replyBody }),
        });
      }
      const { parent, channelId, ...target } = body.replyTarget;
      // Callers that predate message parents send only `channelId`; the
      // node itself references any parent the reply lives under.
      const replyParent: ReplyTargetParent | undefined =
        parent ?? (channelId ? { type: 'channel', id: channelId } : undefined);
      const markdown = composeAgentSessionAnnouncement({
        replyTarget: replyParent
          ? { ...target, parent: replyParent }
          : undefined,
        chip: body.chip,
      });
      return c.json({ markdown });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
