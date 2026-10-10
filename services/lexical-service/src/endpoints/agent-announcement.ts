import {
  AGENT_ACTIVITY_CARD_ACTIONS,
  AGENT_ACTIVITY_CARD_ITEM_TYPES,
  AGENT_ACTIVITY_STATUSES,
} from '@macro-inc/lexical-core/nodes/AgentActivityNode';
import { CONNECT_APP_TARGETS } from '@macro-inc/lexical-core/nodes/ConnectAppNode';
import {
  MAGIC_CHIP_AUTHORS,
  MAGIC_CHIP_STATUSES,
} from '@macro-inc/lexical-core/nodes/MagicChipNode';
import {
  REPLY_TARGET_PARENT_TYPES,
  type ReplyTargetParent,
} from '@macro-inc/lexical-core/nodes/ReplyTargetNode';
import { composeAgentSessionAnnouncement } from '@macro-inc/lexical-core/utils/agent-announcement';
import { composeAgentChatReply } from '@macro-inc/lexical-core/utils/agent-chat-reply';
import { composeAgentConnectionPrompt } from '@macro-inc/lexical-core/utils/agent-connection-prompt';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

const messageParent = z.object({
  type: z.enum(REPLY_TARGET_PARENT_TYPES),
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
  replyTarget: replyTargetRequest.optional(),
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
/** What a step produced: an item it made, changed or sent, or a view. */
const activityCard = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    itemType: z.enum(AGENT_ACTIVITY_CARD_ITEM_TYPES),
    itemId: z.string().min(1),
    fileType: z.string().nullish(),
    action: z.enum(AGENT_ACTIVITY_CARD_ACTIONS),
    title: z.string().nullish(),
  }),
  z.object({ kind: z.literal('view'), view: z.unknown() }),
]);

const activityRow = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().nullish(),
  status: z.enum(AGENT_ACTIVITY_STATUSES),
  card: activityCard.nullish(),
});

const replySegment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prose'), markdown: z.string() }),
  z.object({
    kind: z.literal('activity'),
    turn: z.number().int().nonnegative(),
    segment: z.number().int().nonnegative(),
    rows: z.array(activityRow),
    sealed: z.boolean(),
  }),
]);

const chatReplyRequest = z.object({
  chatReply: z.object({
    sessionId: z.string().min(1),
    link: z.boolean().optional(),
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pending') }),
      z.object({ kind: z.literal('markdown'), markdown: z.string() }),
      z.object({
        kind: z.literal('segments'),
        segments: z.array(replySegment),
        pending: z.boolean().optional(),
        footer: z.string().nullish(),
      }),
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
        const { sessionId, link, body: replyBody } = body.chatReply;
        // The schema requires a body, but the discriminated union does not
        // survive chanfana's OpenAPI round-trip as required, so it arrives
        // typed as optional. Refuse rather than invent a state: a reply with
        // no body is a caller bug, and guessing one would post it to a thread.
        if (!replyBody) {
          throw new Error('chatReply needs a body');
        }
        return c.json({
          markdown: composeAgentChatReply({
            sessionId,
            link,
            body:
              replyBody.kind === 'segments'
                ? {
                    kind: 'segments',
                    pending: replyBody.pending,
                    footer: replyBody.footer ?? undefined,
                    segments: replyBody.segments.map((segment) =>
                      segment.kind === 'prose'
                        ? segment
                        : {
                            ...segment,
                            rows: segment.rows.map((row) => ({
                              id: row.id,
                              label: row.label,
                              status: row.status,
                              ...(row.detail ? { detail: row.detail } : {}),
                              ...(row.card
                                ? {
                                    card:
                                      row.card.kind === 'view'
                                        ? { kind: 'view', view: row.card.view }
                                        : row.card,
                                  }
                                : {}),
                            })),
                          }
                    ),
                  }
                : replyBody,
          }),
        });
      }
      const target = body.replyTarget;
      // Assignments have no user-authored message to quote.
      const replyParent: ReplyTargetParent | undefined = target
        ? (target.parent ??
          (target.channelId
            ? { type: 'channel', id: target.channelId }
            : undefined))
        : undefined;
      const markdown = composeAgentSessionAnnouncement({
        replyTarget:
          target && replyParent
            ? {
                parent: replyParent,
                targetMessageId: target.targetMessageId,
                targetThreadId: target.targetThreadId,
                displayText: target.displayText,
                senderId: target.senderId,
              }
            : undefined,
        chip: body.chip,
      });
      return c.json({ markdown });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
