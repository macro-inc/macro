import {
  type AgentContextPrompt,
  composeAgentContextPrompt,
} from '@macro-inc/lexical-core/utils/agent-context';
import { describe, expect, it } from 'vitest';
import { agentContextText, promptOrigin } from './prompt-origin';

const julia = {
  id: 'macro|julia@example.com',
  name: 'Julia',
  email: 'julia@example.com',
};
const teo = {
  id: 'macro|teo@example.com',
  name: 'Teo',
  email: 'teo@example.com',
};
const agent = { id: 'bot|00000000-0000-0000-0000-00000000c5c5', name: 'Macro' };

/** The origin of a prompt the real composer wrote. */
function originOf(input: AgentContextPrompt) {
  const text = agentContextText(composeAgentContextPrompt(input));
  if (text === undefined) throw new Error('the composer wrote no context');
  return promptOrigin(text);
}

describe('agentContextText', () => {
  it('reads the context text out of the envelope', () => {
    expect(
      agentContextText(
        '<m-agent-context>{"version":1,"text":"<trigger kind=\\"requested\\"/>"}</m-agent-context>\nhello'
      )
    ).toBe('<trigger kind="requested"/>');
  });

  it('is undefined for a prompt without context', () => {
    expect(agentContextText('hello')).toBeUndefined();
  });
});

describe('promptOrigin', () => {
  it('names the channel and points at the mention in its thread', () => {
    expect(
      originOf({
        promptMarkdown: 'why do the snapshot tests flake?',
        trigger: {
          kind: 'mentioned',
          surface: {
            type: 'channel',
            id: 'c1',
            name: 'eng',
            channel_type: 'public',
          },
          prompt_message_id: 'm2',
          sender: julia,
          reply_target: { kind: 'thread', root_id: 'm1' },
          thread: {
            root_id: 'm1',
            messages: [
              {
                id: 'm1',
                author: teo,
                content: 'third red build today',
                posted_at: '2026-10-15T14:00:00Z',
              },
              {
                id: 'm2',
                author: julia,
                content: 'why do the snapshot tests flake?',
                posted_at: '2026-10-15T14:02:00Z',
              },
            ],
            messages_omitted: false,
          },
        },
      })
    ).toEqual({
      lead: 'via @mention in',
      place: '#eng',
      tail: undefined,
      destination: {
        kind: 'channel_message',
        channelId: 'c1',
        messageId: 'm2',
        threadId: 'm1',
      },
    });
  });

  it('names a direct message by its sender and points at the top-level message', () => {
    expect(
      originOf({
        promptMarkdown: 'draft a reply to Acme',
        trigger: {
          kind: 'mentioned',
          surface: {
            type: 'channel',
            id: 'c2',
            channel_type: 'direct_message',
          },
          prompt_message_id: 'd1',
          sender: teo,
          reply_target: { kind: 'none' },
          channel: [
            {
              root_id: 'd1',
              messages: [
                {
                  id: 'd1',
                  author: teo,
                  content: 'draft a reply to Acme',
                  posted_at: '2026-10-15T11:40:00Z',
                },
              ],
              messages_omitted: false,
            },
          ],
        },
      })
    ).toEqual({
      lead: 'via @mention in',
      place: 'a DM with Teo',
      tail: undefined,
      destination: {
        kind: 'channel_message',
        channelId: 'c2',
        messageId: 'd1',
        threadId: undefined,
      },
    });
  });

  it('points a document comment mention at its comment', () => {
    expect(
      originOf({
        promptMarkdown: 'can you check the QA calendar?',
        trigger: {
          kind: 'mentioned',
          surface: {
            type: 'document_comment',
            id: 'doc-1',
            name: 'Launch plan',
          },
          prompt_message_id: 'm2',
          sender: julia,
          reply_target: { kind: 'thread', root_id: 'm1' },
          thread: {
            root_id: 'm1',
            messages: [
              {
                id: 'm2',
                author: julia,
                content: 'can you check the QA calendar?',
                posted_at: '2026-10-15T14:02:00Z',
              },
            ],
            messages_omitted: false,
          },
        },
      })
    ).toEqual({
      lead: 'via @mention in',
      place: 'a comment on Launch plan',
      tail: undefined,
      destination: { kind: 'document', documentId: 'doc-1', commentId: 'm2' },
    });
  });

  it('names project, CRM and call chat surfaces', () => {
    const on = (
      surface: Extract<
        AgentContextPrompt['trigger'],
        { kind: 'mentioned' }
      >['surface']
    ) =>
      originOf({
        promptMarkdown: 'summarize this',
        trigger: {
          kind: 'mentioned',
          surface,
          prompt_message_id: 'm1',
          sender: julia,
          reply_target: { kind: 'none' },
          channel: [
            {
              root_id: 'm1',
              messages: [
                {
                  id: 'm1',
                  author: julia,
                  content: 'summarize this',
                  posted_at: '2026-10-15T14:02:00Z',
                },
              ],
              messages_omitted: false,
            },
          ],
        },
      });

    expect(
      on({ type: 'project_comment', id: 'p1', name: 'Calendar polish' })
    ).toMatchObject({
      place: 'a comment on Calendar polish',
      destination: { kind: 'project', projectId: 'p1' },
    });
    expect(
      on({ type: 'crm_company_comment', id: 'co1', name: 'Acme Corp' })
    ).toMatchObject({
      place: 'a comment on Acme Corp',
      destination: { kind: 'crm_company', companyId: 'co1', commentId: 'm1' },
    });
    expect(
      on({ type: 'crm_contact_comment', id: 'ct1', name: 'Sam Lee' })
    ).toMatchObject({
      place: 'a comment on Sam Lee',
      destination: { kind: 'crm_contact', contactId: 'ct1', commentId: 'm1' },
    });
    expect(
      on({ type: 'call_chat', id: 'call-0', title: 'Standup' })
    ).toMatchObject({
      place: 'Standup call chat',
      destination: { kind: 'call', callId: 'call-0' },
    });
  });

  it('says how a follow-up reached the agent', () => {
    const followUp = (
      addressed_by: 'mention' | 'explicit_reply' | 'inferred'
    ) =>
      originOf({
        promptMarkdown: 'and the popover one too',
        trigger: {
          kind: 'follow_up',
          addressed_by,
          discussion: {
            surface: {
              type: 'channel',
              id: 'c1',
              name: 'eng',
              channel_type: 'public',
            },
            prompt_message_id: 'p',
            sender: julia,
            reply_target: { kind: 'none' },
            channel: [
              {
                root_id: 'p',
                messages: [
                  {
                    id: 'p',
                    author: julia,
                    content: 'and the popover one too',
                    posted_at: '2026-10-15T14:02:00Z',
                  },
                ],
                messages_omitted: false,
              },
            ],
          },
        },
      });

    expect(followUp('mention')).toMatchObject({
      lead: 'via @mention in',
      place: '#eng',
      tail: undefined,
    });
    expect(followUp('explicit_reply')).toMatchObject({
      lead: 'via reply in',
      place: '#eng',
      tail: undefined,
    });
    expect(followUp('inferred')).toMatchObject({
      lead: 'via message in',
      place: '#eng',
      tail: '(inferred)',
      destination: { kind: 'channel_message', channelId: 'c1', messageId: 'p' },
    });
  });

  it('names the assigned task and who assigned it', () => {
    expect(
      originOf({
        promptMarkdown: 'Work on the assigned task.',
        trigger: {
          kind: 'task_assigned',
          task: {
            id: 'task-1',
            title: 'Fix calendar popover scroll',
            markdown: 'The popover scrolls the page behind it.',
            status: 'Todo',
            assignees: [agent],
          },
          assigned_by: julia,
          assigned_at: '2026-10-15T14:02:00Z',
          discussion_id: 'd1',
        },
      })
    ).toEqual({
      lead: 'via task',
      place: 'Fix calendar popover scroll',
      tail: 'from Julia',
      destination: { kind: 'task', taskId: 'task-1' },
    });
  });

  it('names the repository of a composer request and links to it', () => {
    expect(
      originOf({
        promptMarkdown: 'Upgrade the lexical packages.',
        trigger: {
          kind: 'requested',
          requested_by: julia,
          requested_at: '2026-10-15T14:02:00Z',
          repo_url: 'https://github.com/macro-inc/macro',
        },
      })
    ).toEqual({
      lead: 'via composer in',
      place: 'macro-inc/macro',
      tail: undefined,
      destination: {
        kind: 'external',
        url: 'https://github.com/macro-inc/macro',
      },
    });
  });

  it('points a handoff at the session that dispatched it', () => {
    expect(
      originOf({
        promptMarkdown: 'Fix the flaky sync test.',
        trigger: {
          kind: 'dispatched',
          dispatched_by: julia,
          dispatched_at: '2026-10-15T14:02:00Z',
          from_bot: '00000000-0000-0000-0000-00000000a2a2',
          from_session: 's-1',
        },
      })
    ).toEqual({
      lead: 'via handoff from',
      place: 'another agent',
      tail: 'for Julia',
      destination: { kind: 'agent_session', sessionId: 's-1' },
    });
  });

  it('points a scheduled routine run at the routine', () => {
    expect(
      originOf({
        promptMarkdown: 'Triage the inbox.',
        trigger: {
          kind: 'routine',
          routine_id: 'r-1',
          name: 'Morning triage',
          owner: julia,
          instructions: 'Sort new email.',
          triggers: [
            { type: 'schedule', cron: '0 0 9 * * MON-FRI', timezone: 'UTC' },
          ],
          firing: {
            type: 'scheduled',
            scheduled_for: '2026-10-15T09:00:00Z',
            schedule: 'Every weekday at 9:00',
          },
        },
      })
    ).toEqual({
      lead: 'via routine',
      place: 'Morning triage',
      tail: '· every weekday at 9:00',
      destination: { kind: 'routine', routineId: 'r-1' },
    });
  });

  it('points an event routine run at what fired it', () => {
    const routine = (
      firing: Extract<
        AgentContextPrompt['trigger'],
        { kind: 'routine' }
      >['firing']
    ) =>
      originOf({
        promptMarkdown: 'Do the thing.',
        trigger: {
          kind: 'routine',
          routine_id: 'r-2',
          name: 'Watcher',
          owner: julia,
          instructions: 'Do the thing.',
          triggers: [{ type: 'events', events: ['any'] }],
          firing,
        },
      });

    expect(
      routine({
        type: 'event',
        event: {
          event: 'task_status_changed',
          task: {
            id: 'task-2',
            title: 'Renew SSL cert',
            markdown: '',
            status: 'Blocked',
          },
        },
      })
    ).toEqual({
      lead: 'via routine',
      place: 'Watcher',
      tail: '· Renew SSL cert moved to Blocked',
      destination: { kind: 'task', taskId: 'task-2' },
    });

    expect(
      routine({
        type: 'event',
        event: {
          event: 'email_received',
          email: {
            thread_id: 'e-1',
            subject: 'Invoice #42',
            from: 'Acme Billing <billing@acme.test>',
            to: ['julia@example.com'],
            received_at: '2026-10-15T08:15:00Z',
            body: 'Attached.',
          },
        },
      })
    ).toEqual({
      lead: 'via routine',
      place: 'Watcher',
      tail: '· email from Acme Billing',
      destination: { kind: 'email_thread', threadId: 'e-1' },
    });

    expect(
      routine({
        type: 'event',
        event: {
          event: 'channel_message_attachment_created',
          entity_type: 'document',
          entity_id: 'doc-q3',
          discussion: {
            surface: {
              type: 'channel',
              id: 'c2',
              channel_type: 'direct_message',
            },
            prompt_message_id: 'f1',
            sender: teo,
            reply_target: { kind: 'none' },
            thread: {
              root_id: 'q',
              messages: [
                {
                  id: 'f1',
                  author: teo,
                  content: 'here you go',
                  posted_at: '2026-10-15T10:05:00Z',
                },
              ],
              messages_omitted: true,
            },
          },
        },
      })
    ).toEqual({
      lead: 'via routine',
      place: 'Watcher',
      tail: '· file from Teo',
      destination: {
        kind: 'channel_message',
        channelId: 'c2',
        messageId: 'f1',
        threadId: 'q',
      },
    });

    expect(
      routine({
        type: 'event',
        event: {
          event: 'call_ended',
          call: {
            id: 'call-1',
            title: 'Acme renewal',
            started_at: '2026-10-15T14:00:00Z',
            ended_at: '2026-10-15T14:30:00Z',
            participants: [],
            transcript_omitted: false,
          },
        },
      })
    ).toEqual({
      lead: 'via routine',
      place: 'Watcher',
      tail: '· Acme renewal ended',
      destination: { kind: 'call', callId: 'call-1' },
    });
  });

  it('is undefined when the context names no trigger', () => {
    expect(
      promptOrigin(
        '<session owner="Julia" owner_id="macro|julia@example.com"/>'
      )
    ).toBeUndefined();
    expect(promptOrigin('Prior message 1: <unclosed')).toBeUndefined();
  });
});
