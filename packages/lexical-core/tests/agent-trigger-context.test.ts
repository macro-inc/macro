import { describe, expect, it } from 'vitest';
import type { SerializedAgentContextNode } from '../nodes/AgentContextNode';
import { composeAgentContextPrompt } from '../utils/agent-context';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';

function hiddenContext(markdown: string): string | undefined {
  const [first] =
    markdownToSerializedEditorStateWithIds(markdown).root.children;
  if (first?.type !== 'agent-context') return undefined;
  return (first as SerializedAgentContextNode).text;
}

describe('composeAgentContextPrompt with a trigger', () => {
  it('renders a mention that opened the session with its document comment discussion', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'can you check the QA calendar?',
      trigger: {
        kind: 'mentioned',
        surface: {
          type: 'document_comment',
          id: 'doc-1',
          name: 'Launch plan',
          anchor: {
            type: 'mark',
            mark_id: 'mark-1',
            marked_text: 'ship Friday',
            current: {
              marked_text: 'ship Monday',
              surrounding_text: 'We ship Monday after QA.',
            },
          },
        },
        prompt_message_id: 'm2',
        sender: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        reply_target: { kind: 'thread', root_id: 'm1' },
        thread: {
          root_id: 'm1',
          messages: [
            {
              id: 'm1',
              author: {
                id: 'macro|teo@example.com',
                name: 'Teo',
                email: 'teo@example.com',
              },
              content: 'Is Monday realistic?',
              posted_at: '2026-10-08T14:00:00Z',
            },
            {
              id: 'm2',
              author: {
                id: 'macro|julia@example.com',
                name: 'Julia',
                email: 'julia@example.com',
              },
              content:
                '<m-user-mention>{"userId":"bot|00000000-0000-0000-0000-00000000c5c5","displayName":"Cursor"}</m-user-mention> can you check the QA calendar?',
              posted_at: '2026-10-08T14:02:00Z',
            },
          ],
          messages_omitted: false,
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="mentioned">',
        '  <note>Julia mentioned you, and that mention opened this session. Their message is the prompt.</note>',
        '  <discussion>',
        '    <document id="doc-1" name="Launch plan">',
        '      <anchor type="mark" mark="mark-1">',
        '        <note>marked_text is what the mark covers in the document now and surrounding_text the passage around it.</note>',
        '        <marked_text>ship Monday</marked_text>',
        '        <surrounding_text>We ship Monday after QA.</surrounding_text>',
        '        <marked_text_when_posted>ship Friday</marked_text_when_posted>',
        '      </anchor>',
        '    </document>',
        '    <origin>This prompt was posted in a document comment thread, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.</origin>',
        '    <sender name="Julia" email="julia@example.com" id="macro|julia@example.com"/>',
        '    <reply_target kind="thread" thread="m1">',
        '      <note>The prompt was posted as a reply in the thread below. It is about that thread.</note>',
        '    </reply_target>',
        '    <thread root="m1">',
        '      <message id="m1" author="Teo" author_email="teo@example.com" author_id="macro|teo@example.com" at="2026-10-08T14:00:00Z">Is Monday realistic?</message>',
        '      <message id="m2" author="Julia" author_email="julia@example.com" author_id="macro|julia@example.com" at="2026-10-08T14:02:00Z" mentioned_you="true">Cursor can you check the QA calendar?</message>',
        '    </thread>',
        '  </discussion>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders an inferred follow-up after the session block and warns the inference can be wrong', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'and the popover one too',
      owner: { id: 'macro|julia@example.com', name: 'Julia' },
      sender: { id: 'macro|julia@example.com', name: 'Julia' },
      trigger: {
        kind: 'follow_up',
        addressed_by: 'inferred',
        discussion: {
          surface: {
            type: 'channel',
            id: 'c1',
            name: 'eng',
            channel_type: 'public',
          },
          prompt_message_id: 'p',
          sender: {
            id: 'macro|julia@example.com',
            name: 'Julia',
            email: 'julia@example.com',
          },
          reply_target: { kind: 'none' },
          channel: [
            {
              root_id: 'old',
              messages: [
                {
                  id: 'old',
                  author: {
                    id: 'macro|teo@example.com',
                    name: 'Teo',
                    email: 'teo@example.com',
                  },
                  content: 'spinner never stops',
                  posted_at: '2026-10-08T13:00:00Z',
                },
                {
                  id: 'old2',
                  author: {
                    id: 'bot|00000000-0000-0000-0000-00000000c5c5',
                    name: 'Cursor',
                  },
                  content: 'Fixed in #12.',
                  posted_at: '2026-10-08T13:30:00Z',
                },
              ],
              messages_omitted: false,
            },
            {
              root_id: 'p',
              messages: [
                {
                  id: 'p',
                  author: {
                    id: 'macro|julia@example.com',
                    name: 'Julia',
                    email: 'julia@example.com',
                  },
                  content: 'and the popover one too',
                  posted_at: '2026-10-08T14:02:00Z',
                },
              ],
              messages_omitted: false,
            },
          ],
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<session owner="Julia" owner_id="macro|julia@example.com">',
        '  <prompted_by name="Julia" id="macro|julia@example.com" is_owner="true"/>',
        '  <note>Julia owns this session and sent this prompt.</note>',
        '</session>',
        '<trigger kind="follow_up" addressed_by="inferred">',
        '  <note>This session was already running when Julia posted this message in its discussion. It neither mentions you nor quote-replies to you: a model judged from the discussion that it was meant for you. That judgment can be wrong, so if the message reads as meant for someone else, say so briefly instead of acting on it. The message is the prompt.</note>',
        '  <discussion>',
        '    <channel id="c1" name="eng" type="public"/>',
        '    <origin>This prompt was posted in a channel thread, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.</origin>',
        '    <sender name="Julia" email="julia@example.com" id="macro|julia@example.com"/>',
        '    <reply_target kind="none">',
        '      <note>The prompt was posted at the top level of the channel and replies to no particular message.</note>',
        '    </reply_target>',
        '    <channel_recent>',
        '      <note>Recent messages in this channel, grouped by thread, oldest first.</note>',
        '      <thread root="old">',
        '        <message id="old" author="Teo" author_email="teo@example.com" author_id="macro|teo@example.com" at="2026-10-08T13:00:00Z">spinner never stops</message>',
        '        <message id="old2" author="Cursor" author_id="bot|00000000-0000-0000-0000-00000000c5c5" at="2026-10-08T13:30:00Z">Fixed in #12.</message>',
        '      </thread>',
        '      <message id="p" author="Julia" author_email="julia@example.com" author_id="macro|julia@example.com" at="2026-10-08T14:02:00Z" addressed_to_you="true">and the popover one too</message>',
        '    </channel_recent>',
        '  </discussion>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a task assignment with the task, how the agent came to own it, and where it answers', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'Work on the assigned task.',
      trigger: {
        kind: 'task_assigned',
        task: {
          id: 'task-1',
          title: 'Fix calendar popover scroll',
          markdown:
            'The popover scrolls the page behind it. Ask <m-user-mention>{"userId":"macro|teo@example.com","displayName":"Teo"}</m-user-mention> for repro steps.',
          status: 'Todo',
          priority: 'High',
          due: '2026-10-10T00:00:00Z',
          assignees: [
            { id: 'bot|00000000-0000-0000-0000-00000000c5c5', name: 'Cursor' },
          ],
          project: { id: 'p-a1', name: 'Calendar polish' },
        },
        assigned_by: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        assigned_at: '2026-10-08T14:02:00Z',
        discussion_id: 'd1',
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="task_assigned" discussion="d1">',
        '  <note>Julia assigned you this task. Your replies are posted to your own discussion on the task, where Julia and others on the task read them.</note>',
        '  <assigned by="Julia" by_email="julia@example.com" by_id="macro|julia@example.com" at="2026-10-08T14:02:00Z"/>',
        '  <task id="task-1" title="Fix calendar popover scroll" status="Todo" priority="High" due="2026-10-10T00:00:00Z">',
        '    <project id="p-a1" name="Calendar polish"/>',
        '    <assignees>',
        '      <assignee name="Cursor" id="bot|00000000-0000-0000-0000-00000000c5c5"/>',
        '    </assignees>',
        '    <description>The popover scrolls the page behind it. Ask Teo for repro steps.</description>',
        '  </task>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a composer request and says the prompt follows', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'Upgrade the lexical packages.',
      trigger: {
        kind: 'requested',
        requested_by: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        requested_at: '2026-10-08T14:02:00Z',
        repo_url: 'https://github.com/macro-inc/macro',
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="requested">',
        '  <note>Julia opened this session from the composer. Their prompt follows.</note>',
        '  <requested by="Julia" by_email="julia@example.com" by_id="macro|julia@example.com" at="2026-10-08T14:02:00Z" repo="https://github.com/macro-inc/macro"/>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a dispatch from another agent', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'Fix the flaky sync test.',
      trigger: {
        kind: 'dispatched',
        dispatched_by: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        dispatched_at: '2026-10-08T14:02:00Z',
        from_bot: '00000000-0000-0000-0000-00000000a2a2',
        from_session: 's-1',
        repo_url: 'https://github.com/macro-inc/macro',
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="dispatched">',
        '  <note>Another agent handed you this task on behalf of Julia. The prompt is the task it handed over.</note>',
        '  <dispatched by="Julia" by_email="julia@example.com" by_id="macro|julia@example.com" at="2026-10-08T14:02:00Z" from_bot="00000000-0000-0000-0000-00000000a2a2" from_session="s-1" repo="https://github.com/macro-inc/macro"/>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a scheduled routine run', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'Triage the inbox.',
      trigger: {
        kind: 'routine',
        routine_id: 'r-1',
        name: 'Morning triage',
        owner: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        instructions: 'Sort new email into Finance and Support.',
        triggers: [
          {
            type: 'schedule',
            cron: '0 0 9 * * MON-FRI',
            timezone: 'America/New_York',
          },
        ],
        firing: {
          type: 'scheduled',
          scheduled_for: '2026-10-08T09:00:00Z',
          schedule: 'Every weekday at 9:00',
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="routine">',
        '  <note>The routine Morning triage, owned by Julia, fired. The prompt is what the routine asks you to do.</note>',
        '  <routine id="r-1" name="Morning triage" owner="Julia" owner_email="julia@example.com" owner_id="macro|julia@example.com"/>',
        '  <instructions>Sort new email into Finance and Support.</instructions>',
        '  <triggers>',
        '    <schedule cron="0 0 9 * * MON-FRI" timezone="America/New_York"/>',
        '  </triggers>',
        '  <scheduled for="2026-10-08T09:00:00Z" schedule="Every weekday at 9:00">',
        '    <note>The routine ran because its schedule came due.</note>',
        '  </scheduled>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a routine fired by a task status change, with the change and the condition', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'Escalate the blocker.',
      trigger: {
        kind: 'routine',
        routine_id: 'r-2',
        name: 'Escalate blockers',
        owner: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        instructions: 'Tell the team when a task gets blocked.',
        triggers: [
          {
            type: 'events',
            events: ['task.status_changed'],
            condition: 'Did the task move to Blocked?',
          },
        ],
        firing: {
          type: 'event',
          event: {
            event: 'task_status_changed',
            task: {
              id: 'task-2',
              title: 'Renew SSL cert',
              markdown: 'Expires Friday.',
              status: 'Blocked',
            },
          },
          conditions: ['Did the task move to Blocked?'],
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="routine">',
        '  <note>The routine Escalate blockers, owned by Julia, fired. The prompt is what the routine asks you to do.</note>',
        '  <routine id="r-2" name="Escalate blockers" owner="Julia" owner_email="julia@example.com" owner_id="macro|julia@example.com"/>',
        '  <instructions>Tell the team when a task gets blocked.</instructions>',
        '  <triggers>',
        '    <events names="task.status_changed">',
        '      <condition>Did the task move to Blocked?</condition>',
        '    </events>',
        '  </triggers>',
        '  <event type="task_status_changed">',
        '    <change property="status" to="Blocked"/>',
        '    <task id="task-2" title="Renew SSL cert" status="Blocked">',
        '      <description>Expires Friday.</description>',
        '    </task>',
        '  </event>',
        '  <conditions>',
        '    <note>The event answered yes to at least one of these.</note>',
        '    <condition>Did the task move to Blocked?</condition>',
        '  </conditions>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a routine fired by an email', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'File the invoice.',
      trigger: {
        kind: 'routine',
        routine_id: 'r-3',
        name: 'Invoice intake',
        owner: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        instructions: 'File invoices into the Finance folder.',
        triggers: [{ type: 'events', events: ['email.message_received'] }],
        firing: {
          type: 'event',
          event: {
            event: 'email_received',
            email: {
              thread_id: 'e-1',
              subject: 'Invoice #42',
              from: 'Acme Billing <billing@acme.test>',
              to: ['julia@example.com', 'ap@example.com'],
              received_at: '2026-10-08T08:15:00Z',
              body: 'Please find invoice #42 attached.',
            },
          },
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="routine">',
        '  <note>The routine Invoice intake, owned by Julia, fired. The prompt is what the routine asks you to do.</note>',
        '  <routine id="r-3" name="Invoice intake" owner="Julia" owner_email="julia@example.com" owner_id="macro|julia@example.com"/>',
        '  <instructions>File invoices into the Finance folder.</instructions>',
        '  <triggers>',
        '    <events names="email.message_received"/>',
        '  </triggers>',
        '  <event type="email_received">',
        '    <email thread="e-1" subject="Invoice #42" from="Acme Billing &lt;billing@acme.test&gt;" to="julia@example.com, ap@example.com" received_at="2026-10-08T08:15:00Z">',
        '      <body>Please find invoice #42 attached.</body>',
        '    </email>',
        '  </event>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('renders a routine fired by a channel attachment without claiming the reply goes there', () => {
    const markdown = composeAgentContextPrompt({
      promptMarkdown: 'File the attachment.',
      trigger: {
        kind: 'routine',
        routine_id: 'r-4',
        name: 'File intake',
        owner: {
          id: 'macro|julia@example.com',
          name: 'Julia',
          email: 'julia@example.com',
        },
        instructions: 'Summarise attached reports.',
        triggers: [
          { type: 'events', events: ['channel.message_attachment_created'] },
        ],
        firing: {
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
              sender: {
                id: 'macro|teo@example.com',
                name: 'Teo',
                email: 'teo@example.com',
              },
              reply_target: {
                kind: 'quote',
                message_id: 'q',
                thread_id: 'q',
                preview: 'send the numbers',
                message: {
                  id: 'q',
                  author: {
                    id: 'macro|julia@example.com',
                    name: 'Julia',
                    email: 'julia@example.com',
                  },
                  content: 'send the numbers',
                  posted_at: '2026-10-08T10:00:00Z',
                },
              },
              thread: {
                root_id: 'q',
                messages: [
                  {
                    id: 'f1',
                    author: {
                      id: 'macro|teo@example.com',
                      name: 'Teo',
                      email: 'teo@example.com',
                    },
                    content: 'here you go',
                    posted_at: '2026-10-08T10:05:00Z',
                  },
                ],
                messages_omitted: true,
              },
            },
          },
        },
      },
    });

    expect(hiddenContext(markdown)).toBe(
      [
        '<trigger kind="routine">',
        '  <note>The routine File intake, owned by Julia, fired. The prompt is what the routine asks you to do.</note>',
        '  <routine id="r-4" name="File intake" owner="Julia" owner_email="julia@example.com" owner_id="macro|julia@example.com"/>',
        '  <instructions>Summarise attached reports.</instructions>',
        '  <triggers>',
        '    <events names="channel.message_attachment_created"/>',
        '  </triggers>',
        '  <event type="channel_message_attachment_created">',
        '    <attachment entity_type="document" entity_id="doc-q3"/>',
        '    <discussion>',
        '      <channel id="c2" type="direct_message"/>',
        '      <sender name="Teo" email="teo@example.com" id="macro|teo@example.com"/>',
        '      <reply_target kind="quote" message="q" thread="q">',
        '        <note>The triggering message quote-replies to this message. It is what the triggering message is about.</note>',
        '        <message id="q" author="Julia" author_email="julia@example.com" author_id="macro|julia@example.com" at="2026-10-08T10:00:00Z">send the numbers</message>',
        '      </reply_target>',
        '      <thread root="q" messages_omitted="true">',
        '        <note>Some messages of this thread are not shown.</note>',
        '        <message id="f1" author="Teo" author_email="teo@example.com" author_id="macro|teo@example.com" at="2026-10-08T10:05:00Z" fired_routine="true">here you go</message>',
        '      </thread>',
        '    </discussion>',
        '  </event>',
        '</trigger>',
      ].join('\n')
    );
  });

  it('refuses a trigger beside the legacy conversation fields', () => {
    expect(() =>
      composeAgentContextPrompt({
        promptMarkdown: 'please fix',
        parent: { type: 'channel', id: 'c1' },
        trigger: {
          kind: 'requested',
          requested_by: { id: 'macro|julia@example.com', name: 'Julia' },
          requested_at: '2026-10-08T14:02:00Z',
        },
      })
    ).toThrow(
      'trigger cannot be combined with legacy conversation fields: parent'
    );
  });
});
