import {
  MAGIC_CHIP_AUTHORS,
  MAGIC_CHIP_STATUSES,
} from '@macro-inc/lexical-core/nodes/MagicChipNode';
import { composeAgentSessionAnnouncement } from '@macro-inc/lexical-core/utils/agent-announcement';
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

const agentAnnouncementRequest = z.object({
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

const agentAnnouncementResponse = z.object({
  markdown: z.string(),
});

export class AgentAnnouncementEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Compose an agent-harness bot response',
    description:
      'Builds an agent-harness announcement from a structured reply target and magic chip.',
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
    try {
      const { body } = await this.getValidatedData<typeof this.schema>();
      const { parent, channelId, ...target } = body.replyTarget;
      // The reply-target node still references channels only; a document
      // discussion announces with the chip alone until the node learns
      // message parents.
      const channel =
        channelId ?? (parent?.type === 'channel' ? parent.id : undefined);
      const markdown = composeAgentSessionAnnouncement({
        replyTarget: channel ? { ...target, channelId: channel } : undefined,
        chip: body.chip,
      });
      return c.json({ markdown });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
