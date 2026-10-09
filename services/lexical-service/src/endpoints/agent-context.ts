import {
  composeAgentContextPrompt,
  legacyConversationFieldsIn,
  type TriggerContext,
} from '@macro-inc/lexical-core/utils/agent-context';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { z } from 'zod';
import { handleEndpointError } from '../lib/error-handler';
import { standardErrorResponses } from '../lib/schemas';

// LEGACY conversation schemas, through `replyTarget`. Remove once every caller
// sends `trigger`.

const messageParent = z.object({
  type: z.enum([
    'channel',
    'document',
    'initiative',
    'crm_company',
    'crm_contact',
    'call',
  ]),
  id: z.string().min(1),
});

const commentAnchor = z.union([
  z.object({
    type: z.literal('spreadsheet'),
    sheetId: z.string().min(1),
    sheetName: z.string(),
    range: z.string().min(1),
  }),
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

// End of the LEGACY conversation schemas.

// The trigger: mirrors the Rust `TriggerContext` wire shape in
// crates/trigger_context/src/lib.rs.

const triggerPerson = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string().optional(),
});

const triggerMessage = z.object({
  id: z.string().min(1),
  author: triggerPerson,
  content: z.string(),
  posted_at: z.string().min(1),
});

const triggerThread = z.object({
  root_id: z.string().min(1),
  messages: z.array(triggerMessage),
  messages_omitted: z.boolean(),
});

const triggerCommentAnchor = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('spreadsheet'),
    sheet_id: z.string().min(1),
    sheet_name: z.string(),
    range: z.string().min(1),
  }),
  z.object({
    type: z.literal('mark'),
    mark_id: z.string().min(1),
    marked_text: z.string().optional(),
    current: z
      .object({ marked_text: z.string(), surrounding_text: z.string() })
      .optional(),
  }),
  z.object({
    type: z.literal('pdf_highlight'),
    anchor_id: z.string().min(1),
    marked_text: z.string().optional(),
  }),
  z.object({
    type: z.literal('pdf_pin'),
    anchor_id: z.string().min(1),
  }),
]);

const namedSurface = <Type extends string>(type: Type) =>
  z.object({ type: z.literal(type), id: z.string().min(1), name: z.string() });

const discussionSurface = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('channel'),
    id: z.string().min(1),
    name: z.string().optional(),
    channel_type: z.enum(['public', 'private', 'direct_message', 'team']),
  }),
  z.object({
    type: z.literal('document_comment'),
    id: z.string().min(1),
    name: z.string(),
    anchor: triggerCommentAnchor.optional(),
  }),
  namedSurface('project_comment'),
  namedSurface('crm_company_comment'),
  namedSurface('crm_contact_comment'),
  z.object({
    type: z.literal('call_chat'),
    id: z.string().min(1),
    title: z.string(),
  }),
]);

const triggerReplyTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote'),
    message_id: z.string().min(1),
    thread_id: z.string().min(1),
    preview: z.string(),
    message: triggerMessage.optional(),
  }),
  z.object({
    kind: z.literal('thread'),
    root_id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('none'),
  }),
]);

const discussionContext = z.object({
  surface: discussionSurface,
  prompt_message_id: z.string().min(1),
  sender: triggerPerson,
  reply_target: triggerReplyTarget,
  thread: triggerThread.optional(),
  channel: z.array(triggerThread).optional(),
});

const projectRef = z.object({
  id: z.string().min(1),
  name: z.string(),
});

const taskSnapshot = z.object({
  id: z.string().min(1),
  title: z.string(),
  markdown: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  due: z.string().optional(),
  assignees: z.array(triggerPerson).optional(),
  project: projectRef.optional(),
});

const documentSnapshot = z.object({
  id: z.string().min(1),
  name: z.string(),
  file_type: z.string(),
  text: z.string().optional(),
});

const emailSnapshot = z.object({
  thread_id: z.string().min(1),
  subject: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  received_at: z.string().min(1),
  body: z.string(),
});

const routineEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('document_created'),
    document: documentSnapshot,
  }),
  z.object({
    event: z.literal('document_updated'),
    document: documentSnapshot,
  }),
  z.object({
    event: z.literal('document_deleted'),
    id: z.string().min(1),
    name: z.string(),
  }),
  z.object({ event: z.literal('task_created'), task: taskSnapshot }),
  z.object({ event: z.literal('task_status_changed'), task: taskSnapshot }),
  z.object({ event: z.literal('task_priority_changed'), task: taskSnapshot }),
  z.object({ event: z.literal('task_property_changed'), task: taskSnapshot }),
  z.object({ event: z.literal('email_received'), email: emailSnapshot }),
  z.object({
    event: z.literal('channel_created'),
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({
    event: z.literal('channel_message_posted'),
    discussion: discussionContext,
  }),
  z.object({
    event: z.literal('channel_mentioned'),
    discussion: discussionContext,
  }),
  z.object({
    event: z.literal('channel_message_patched'),
    discussion: discussionContext,
  }),
  z.object({
    event: z.literal('channel_message_attachment_created'),
    discussion: discussionContext,
    entity_type: z.string().min(1),
    entity_id: z.string().min(1),
  }),
]);

const routineFiring = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('scheduled'),
    scheduled_for: z.string().min(1),
    schedule: z.string(),
  }),
  z.object({
    type: z.literal('manual'),
    requested_at: z.string().min(1),
  }),
  z.object({
    type: z.literal('event'),
    event: routineEvent,
    conditions: z.array(z.string()).optional(),
  }),
]);

const routineTrigger = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schedule'),
    cron: z.string().min(1),
    timezone: z.string().min(1),
  }),
  z.object({
    type: z.literal('events'),
    events: z.array(z.string().min(1)),
    entity_ids: z.array(z.string().min(1)).optional(),
    condition: z.string().optional(),
  }),
]);

const triggerContextSchema = z.discriminatedUnion('kind', [
  discussionContext.extend({ kind: z.literal('mentioned') }),
  z.object({
    kind: z.literal('follow_up'),
    addressed_by: z.enum(['mention', 'explicit_reply', 'inferred']),
    discussion: discussionContext,
  }),
  z.object({
    kind: z.literal('task_assigned'),
    task: taskSnapshot,
    assigned_by: triggerPerson,
    assigned_at: z.string().min(1),
    discussion_id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('requested'),
    requested_by: triggerPerson,
    requested_at: z.string().min(1),
    repo_url: z.string().optional(),
  }),
  z.object({
    kind: z.literal('dispatched'),
    dispatched_by: triggerPerson,
    dispatched_at: z.string().min(1),
    // Rust serializes an absent bot as null.
    from_bot: z.string().nullish(),
    from_session: z.string().optional(),
    repo_url: z.string().optional(),
  }),
  z.object({
    kind: z.literal('routine'),
    routine_id: z.string().min(1),
    name: z.string(),
    owner: triggerPerson,
    instructions: z.string(),
    triggers: z.array(routineTrigger),
    firing: routineFiring,
  }),
]);

/**
 * The trigger schema, typed as the lexical-core contract. This service builds
 * without strictNullChecks, under which zod infers every required union field
 * (surface, reply_target, firing, event) as optional; the runtime schema
 * still requires them.
 */
export const triggerContext: z.ZodType<TriggerContext> =
  triggerContextSchema as z.ZodType<TriggerContext>;

const person = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const agentContextRequest = z
  .object({
    promptMarkdown: z.string(),
    instructions: z.string().optional(),
    owner: person.optional(),
    sender: person.optional(),
    trigger: triggerContext.optional(),
    // LEGACY conversation fields; remove once every caller sends `trigger`.
    parent: messageParent.optional(),
    anchor: commentAnchor.optional(),
    replyTarget: replyTarget.optional(),
    promptMessageId: z.string().min(1).optional(),
    thread: contextThread.optional(),
    channel: z.array(contextThread).optional(),
  })
  .refine(
    (request) =>
      request.trigger === undefined ||
      legacyConversationFieldsIn(request).length === 0,
    {
      message:
        'trigger cannot be combined with parent, anchor, replyTarget, promptMessageId, thread, or channel',
    }
  );

const agentContextResponse = z.object({
  markdown: z.string(),
});

export class AgentContextEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Compose an agent prompt with conversation context',
    description:
      'Builds internal markdown naming the session owner and the prompt sender, and containing trusted session instructions and the trigger that called the agent - a mention or follow-up with its discussion, a task assignment, a composer request, a dispatch, or a routine firing - followed by the user prompt. The legacy conversation fields (parent, anchor, replyTarget, promptMessageId, thread, channel) are still accepted, but not together with trigger.',
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
    // Outside the try: chanfana answers a request that fails the schema with
    // 400, where handleEndpointError would turn it into a 500.
    const { body } = await this.getValidatedData<typeof this.schema>();
    try {
      const markdown = composeAgentContextPrompt(body);
      return c.json({ markdown });
    } catch (error) {
      return handleEndpointError(error, c);
    }
  }
}
