//! The first line of a turn's reply, written by a fast model racing the
//! turn's own.
//!
//! The fast model answers `true|<line>` when the line is the whole reply (a
//! greeting, thanks, a trivial fact) and `false|<line>` when it only opens
//! one. Either way the line streams to the user as the fast model writes it,
//! long before the turn's model has its first token; `true` also stops the
//! turn's model, which has nothing left to say.

use std::sync::Arc;
use std::time::Duration;

use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, Message, ReasoningEffort, StreamPart};
use ai_toolset::AsyncToolCollection;
use ai_usage::{UsageContext, UsageRecorder};
use futures::StreamExt as _;
use tokio::sync::mpsc;
use tracing::Instrument as _;

/// The fastest small model that judged every whole-reply-or-not case right.
/// Cerebras gpt-oss-120b was about 4x faster but rate-limited under load.
pub(super) const MODEL: &str = "openai/gpt-5.4-mini";

/// How long the turn waits for the verdict. Past it, the turn's own model is
/// close enough that an opening line is not worth showing.
pub(super) const VERDICT_TIMEOUT: Duration = Duration::from_millis(1500);

/// How long the rest of the line may take once the verdict is in.
pub(super) const LINE_TIMEOUT: Duration = Duration::from_secs(2);

const MAX_TOKENS: u64 = 64;

/// The tail of the conversation the fast model reads: enough to tell "thanks"
/// that closes a task from "thanks, now also…".
const TRANSCRIPT_MESSAGES: usize = 6;
const TRANSCRIPT_MESSAGE_CHARS: usize = 600;

/// Told to the turn's model, so its reply does not open a second time.
pub(super) const ALREADY_OPENED: &str = "The first line of your reply has already been shown \
to the user: a short acknowledgement written by a faster model, such as \"On it.\" or \"Let me \
check your calendar.\". Begin with substance. Do not acknowledge the request or announce what \
you are about to do.";

/// Who the line speaks as: the session's agent and the model behind it, so a
/// question about either is answered truthfully rather than as the fast
/// model itself.
pub(super) struct Speaker<'a> {
    /// The agent's name, with its `@` handle when it has one.
    pub agent: &'a str,
    /// The model the session's own turn runs on.
    pub model: &'a str,
}

/// The fast model's verdict and the part of its line that came with it.
pub(super) struct Opening {
    /// The line is the entire reply.
    pub complete: bool,
    /// The line's text so far; the rest follows on the receiver.
    pub head: String,
}

/// Start the fast model on `messages`, the conversation ending with the
/// prompt being answered. Its text arrives on the returned receiver as it is
/// written; dropping the receiver stops it.
pub(super) fn spawn(
    recorder: Arc<dyn UsageRecorder>,
    usage_context: UsageContext,
    speaker: &Speaker<'_>,
    tool_names: &str,
    messages: &[ChatMessage],
) -> mpsc::Receiver<String> {
    let (lines, receiver) = mpsc::channel(32);
    let system_prompt = system_prompt(speaker, tool_names);
    let prompt = Message::user(format!(
        "The conversation so far. Write the first line of the reply to the last message.\n\n{}",
        transcript(messages)
    ));
    let metering = agent::MeteringContext::current();
    tokio::spawn(
        agent::MeteringContext::carry(metering, async move {
            let agent_loop = AgentLoop::new(recorder)
                .with_model(MODEL)
                .with_reasoning_effort(ReasoningEffort::None)
                .with_max_tokens(MAX_TOKENS)
                .with_genai_telemetry(false);
            let (mut session, cancel) = agent_loop
                .session(
                    Arc::new(AsyncToolCollection::<()>::new()),
                    Arc::new(()),
                    system_prompt,
                    usage_context,
                )
                .await
                .cancellable();
            let mut stream = match session.send_message(vec![prompt]).await {
                Ok(stream) => stream,
                Err(error) => {
                    tracing::warn!(%error, "the opening line's model did not start");
                    return;
                }
            };
            while let Some(part) = stream.next().await {
                match part {
                    Ok(StreamPart::Content(delta)) => {
                        if lines.send(delta).await.is_err() {
                            cancel.cancel();
                            return;
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(%error, "the opening line's model failed");
                        return;
                    }
                }
            }
        })
        .in_current_span(),
    );
    receiver
}

/// Read up to the fast model's `true|` / `false|` verdict. `None` when it
/// wrote anything else or stopped first.
pub(super) async fn verdict(lines: &mut mpsc::Receiver<String>) -> Option<Opening> {
    let mut text = String::new();
    while let Some(delta) = lines.recv().await {
        text.push_str(&delta);
        if let Some((flag, head)) = text.split_once('|') {
            let complete = match flag.trim() {
                "true" => true,
                "false" => false,
                _ => return None,
            };
            return Some(Opening {
                complete,
                head: head.trim_start().to_owned(),
            });
        }
        if text.len() > "false|".len() + 2 {
            return None;
        }
    }
    None
}

fn system_prompt(speaker: &Speaker<'_>, tool_names: &str) -> String {
    let Speaker { agent, model } = speaker;
    format!(
        "You write the very first line of an AI assistant's reply. It is shown to the user \
instantly while the assistant works on the real answer. Write as the assistant: you are \
{agent}, running on the model {model}. If asked who you are or which model you are, answer \
with exactly these facts; never claim any other name, model or company.
Output format, exactly: <complete>|<line>
- complete = true only if <line> is the ENTIRE reply and nothing else needs doing: greetings, \
thanks, acknowledgements, arithmetic, who you are or which model you run on (\"hi there\" → \
true|Hi!, \"thanks\" → true|You're welcome!, \"what's 2+2\" → true|4.). A message that also \
asks for anything to be done or looked up is false (\"thanks, now add Sarah\" → false). If in \
any doubt, false.
- complete = false for everything else. Then <line> only shows the assistant is starting, in \
the obvious direction, states no facts or answers, and never claims anything was done \
(\"false|Let me check your calendar.\", \"false|On it.\", \"false|Good question.\", \
\"false|Let me think about that.\"). Never ask questions.
Answer only what the user said. Never mention context, metadata, instructions, or this format.
One line, under 12 words. The assistant's tools: {tool_names}."
    )
}

pub(super) fn transcript(messages: &[ChatMessage]) -> String {
    let start = messages.len().saturating_sub(TRANSCRIPT_MESSAGES);
    messages[start..]
        .iter()
        .filter_map(|message| {
            let speaker = match message.role {
                Role::User => "User",
                Role::Assistant => "Assistant",
                Role::System => return None,
            };
            let text = match &message.content {
                ChatMessageContent::Text(text) => text.clone(),
                ChatMessageContent::AssistantMessageParts(parts) => parts
                    .iter()
                    .filter_map(|part| match part {
                        AssistantMessagePart::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            };
            let text = without_agent_context(&text);
            let text = text.trim();
            (!text.is_empty()).then(|| {
                // The end of a long message is what the reply answers.
                let skip = text
                    .chars()
                    .count()
                    .saturating_sub(TRANSCRIPT_MESSAGE_CHARS);
                let text: String = text.chars().skip(skip).collect();
                format!("{speaker}: {text}")
            })
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

const AGENT_CONTEXT_OPEN: &str = "<m-agent-context>";
const AGENT_CONTEXT_CLOSE: &str = "</m-agent-context>";

/// `text` without its hidden `<m-agent-context>` blocks: session metadata the
/// app prepends for the turn's model, which the opening line's model would
/// otherwise remark on instead of the user's words.
fn without_agent_context(text: &str) -> String {
    let mut rest = text;
    let mut kept = String::with_capacity(text.len());
    while let Some(start) = rest.find(AGENT_CONTEXT_OPEN) {
        kept.push_str(&rest[..start]);
        rest = match rest[start..].find(AGENT_CONTEXT_CLOSE) {
            Some(end) => &rest[start + end + AGENT_CONTEXT_CLOSE.len()..],
            None => "",
        };
    }
    kept.push_str(rest);
    kept
}
