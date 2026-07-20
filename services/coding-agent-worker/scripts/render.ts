import type { ContentBlock, SessionNotification } from '@zed-industries/agent-client-protocol'
import chalk from 'chalk'
import { match } from 'ts-pattern'

type SessionUpdate = SessionNotification['update']

const text = (c: ContentBlock) => (c.type === 'text' ? c.text : '')

// Stateful renderer for ACP session updates → pretty terminal output.
// Message and thought text arrive as many small same-kind chunks streamed with
// no newlines; we only insert a newline when the *kind* changes, so thinking,
// message text, and tool calls don't run into each other.
export function makeRenderer() {
  let last = '' // kind of the last thing written to the current line

  // Newline before switching to a different streaming kind.
  const sep = (kind: string) => {
    if (last && last !== kind) process.stdout.write('\n')
    last = kind
  }

  return (update: SessionUpdate) =>
    match(update)
      .with({ sessionUpdate: 'agent_thought_chunk' }, (m) => {
        sep('thought')
        process.stdout.write(chalk.dim(text(m.content)))
      })
      .with({ sessionUpdate: 'agent_message_chunk' }, (m) => {
        sep('message')
        process.stdout.write(text(m.content))
      })
      .with({ sessionUpdate: 'tool_call' }, (m) => {
        sep('tool')
        console.log(chalk.cyan(`⚙ ${m.title || m.toolCallId}`))
        last = '' // console.log already ended the line
      })
      .with({ sessionUpdate: 'tool_call_update' }, (m) => {
        if (!m.status) return
        sep('tool')
        console.log(chalk.cyan(`  → ${m.status}`))
        last = ''
      })
      .otherwise(() => {})
}
