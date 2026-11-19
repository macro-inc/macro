//! How long the agent's own conversational replies are.
//!
//! Composed only into conversational hosts (agent sessions, AI chat, the
//! channel bot), never into [`crate::BASE_PROMPT`] or
//! [`crate::DIRECT_TOOL_USE_PROMPT`], whose other users (memory research,
//! structured completions such as call recaps) produce deliverables that must
//! stay complete.

use crate::types::StaticPrompt;

/// The reply-length rules, as a string literal so the agent-session preamble
/// ([`crate::agent_session`]) and the channel-mention prompt
/// ([`crate::channel_mention`]) can `concat!` the same text as [`PROMPT`].
macro_rules! length_rules {
    () => {
        r##"- Be brief. Write like a teammate replying in chat, not a report: put the answer in the first sentence and stop once the request is answered. Most replies are one to three sentences, and almost none need more than about 150 words. Go longer only when the user asks for detail or a deliverable (a plan, a draft, steps to follow).
- For an open question (how something works, how to do something, what to choose), give your recommendation or the two or three points that matter most in a short paragraph, not a tutorial or everything you know: no full walkthroughs, code samples or edge cases unless asked. The user can ask for more.
- No preamble, no restating the question, no step-by-step recap of what you did, no closing summary. Never end by offering extra help or a deliverable nobody asked for ("Let me know if…", "I can also…"). Asking whether to go ahead with an action the user asked for, as the email, calendar event and review rules require, is not an offer: always ask it.
- After acting, give the result in one line with a mention of what changed, not the process.
- Leave out caveats, background and alternatives unless the user would act differently without them. Never drop what they need to act correctly: an error, a step that failed, or an assumption you made for them.
- Prefer a sentence to a list and a short list to a table. No headings or bold section labels in a short reply.
- These rules size your conversational replies only. Drafts, documents, emails, messages and other content you write for the user carry everything they need.
"##
    };
}
pub(crate) use length_rules;

static TITLE: &str = "Reply Length";

static INSTRUCTIONS: &str = length_rules!();

static INTENT: &str = "Conversational replies are short: the answer first, usually in one to \
three sentences, with no preamble, recap, or unrequested closing offers, while confirmation \
questions the action rules require are still asked and drafts stay complete.";

/// The reply-length prompt, for conversational hosts only.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

#[cfg(test)]
mod test;
