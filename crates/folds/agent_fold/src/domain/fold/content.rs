//! Prose and reasoning chunks, and adding parts to the agent message.

use crate::domain::model::{Author, FoldedMessage, MessagePart};
use non_empty::NonEmpty;

use super::state::{Changed, FoldState, ToolPath};

impl FoldState {
    /// The part at `at`, wherever in the transcript it sits. `None` if the
    /// path no longer resolves, which a well-formed log never produces.
    pub(super) fn part_at_mut(&mut self, at: &ToolPath) -> Option<&mut MessagePart> {
        let (first, rest) = at.path.split_first()?;
        let mut part = self.messages.get_mut(at.message)?.parts.get_mut(*first)?;
        for &index in rest {
            part = part.children_mut()?.get_mut(index)?;
        }
        Some(part)
    }

    /// [`Self::part_at_mut`], read-only.
    pub(super) fn part_at(&self, at: &ToolPath) -> Option<&MessagePart> {
        let (first, rest) = at.path.split_first()?;
        let mut part = self.messages.get(at.message)?.parts.get(*first)?;
        for &index in rest {
            part = part.children().get(index)?;
        }
        Some(part)
    }

    /// Append agent prose, extending the trailing text part when there is one.
    ///
    /// While a notification turn can still end in `<noop/>`, the tail that
    /// could become that signal is held back instead of shown, so the tag
    /// never streams; [`Self::close_turn`] settles what is still held.
    pub(super) fn append_text(&mut self, text: String) -> Option<Changed> {
        let text = match self.turn.as_mut() {
            Some(turn) if turn.can_noop => {
                turn.noop_buffer.push_str(&text);
                let held = turn
                    .noop_buffer
                    .split_off(held_noop_tail(&turn.noop_buffer));
                std::mem::replace(&mut turn.noop_buffer, held)
            }
            _ => text,
        };
        self.show_text(text)
    }

    /// Put prose in the agent message, after any reasoning held back with it.
    fn show_text(&mut self, text: String) -> Option<Changed> {
        if text.is_empty() {
            return None;
        }

        let new_message = self.turn.as_ref().is_some_and(|turn| turn.agent.is_none());
        let thought = self
            .turn
            .as_mut()
            .map(|turn| std::mem::take(&mut turn.pending_thought))
            .unwrap_or_default();
        if !thought.is_empty() {
            self.show_thought(thought);
        }
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Text { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Text { text })
            .map(|(changed, _)| {
                if new_message {
                    Changed::new(changed.message)
                } else {
                    changed
                }
            })
    }

    /// Append agent reasoning, extending the trailing thought part when there
    /// is one.
    ///
    /// Reasoning before any prose in a turn that may still be silent waits
    /// with it. Once prose shows, reasoning ends the text it follows: held
    /// text is shown first, since a tag the agent kept talking after is not
    /// the trailing signal.
    pub(super) fn append_thought(&mut self, text: String) -> Option<Changed> {
        if let Some(turn) = self.turn.as_mut()
            && turn.can_noop
        {
            if turn.agent.is_none() {
                turn.pending_thought.push_str(&text);
                return None;
            }
            let held = std::mem::take(&mut turn.noop_buffer);
            self.show_text(held);
        }
        self.show_thought(text)
    }

    /// Put reasoning in the agent message.
    fn show_thought(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Thought { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Thought { text })
            .map(|(changed, _)| changed)
    }

    /// Settle text a notification turn held back as a possible `<noop/>`,
    /// now that the turn is ending.
    ///
    /// A reply that is only the signal stays held, for [`Self::close_turn`]
    /// to record as a silent turn. A signal after prose is dropped and the
    /// prose kept. Anything else held was the agent's text and is shown.
    pub(super) fn settle_held_noop(&mut self) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        if !turn.can_noop || turn.answered_with_noop() {
            return;
        }

        turn.can_noop = false;
        let held = std::mem::take(&mut turn.noop_buffer);
        let thought = std::mem::take(&mut turn.pending_thought);
        if !thought.is_empty() {
            self.show_thought(thought);
        }
        if !is_noop_signal(&held) {
            self.show_text(held);
        }
    }

    /// Add a part to the open turn's agent message, creating that message if
    /// this is the first part the agent has produced in the turn - and the
    /// turn itself if the agent is talking without one.
    ///
    /// Every way the agent contributes content comes through here, which is
    /// why opening the turn belongs here rather than in each caller.
    pub(super) fn push_agent_part(&mut self, part: MessagePart) -> Option<(Changed, usize)> {
        let new_message = self.turn.as_ref().is_some_and(|turn| turn.agent.is_none());
        if !matches!(part, MessagePart::Text { .. } | MessagePart::Thought { .. }) {
            // Conservatively treat every tool as potentially side effecting.
            let thought = self
                .turn
                .as_mut()
                .map(|turn| std::mem::take(&mut turn.pending_thought))
                .unwrap_or_default();
            let buffered = self
                .turn
                .as_mut()
                .map(|turn| {
                    turn.can_noop = false;
                    std::mem::take(&mut turn.noop_buffer)
                })
                .unwrap_or_default();
            if !thought.is_empty() {
                self.show_thought(thought);
            }
            self.show_text(buffered);
        }
        if self.turn.is_none() {
            self.begin_turn_without_prompt();
        }
        let turn = self.turn.as_ref()?;
        let turn_id = turn.id;
        let agent = turn.agent;

        let Some(message) = agent else {
            let message = self.messages.len();
            self.messages.push(FoldedMessage {
                id: turn_id,
                author: Author::Agent,
                request_id: None,
                parts: NonEmpty::one(part),
                stop: None,
                pending: self.speculative,
                posted_at: None,
            });
            self.open_turn().agent = Some(message);
            return Some((Changed::new(message), 0));
        };

        let parts = &mut self.messages[message].parts;
        let position = parts.len();
        parts.push(part);
        Some((
            if new_message {
                Changed::new(message)
            } else {
                Changed::updated(message)
            },
            position,
        ))
    }

    /// The open turn's agent message: where it sits in [`State::messages`],
    /// and its parts. `None` until the agent has produced a part.
    pub(super) fn agent_parts_mut(&mut self) -> Option<(usize, &mut NonEmpty<Vec<MessagePart>>)> {
        let message = self.turn.as_ref()?.agent?;
        Some((message, &mut self.messages[message].parts))
    }
}

/// The notification-only reply that means "nothing to say".
const NOOP_SIGNAL: &str = "<noop/>";

/// Whether held text is the noop signal, give or take surrounding whitespace.
pub(super) fn is_noop_signal(text: &str) -> bool {
    text.trim() == NOOP_SIGNAL
}

/// Where the tail of `text` that could still end the reply as `<noop/>`
/// begins: the whole signal, or a prefix of it the next chunk may complete,
/// with any whitespace on either side of it. Returns `text.len()` when no
/// tail could.
fn held_noop_tail(text: &str) -> usize {
    let trimmed = text.trim_end();
    let tag_start = if trimmed.ends_with(NOOP_SIGNAL) {
        trimmed.len() - NOOP_SIGNAL.len()
    } else if trimmed.len() < text.len() {
        // Trailing whitespace after anything else: the signal may follow it.
        trimmed.len()
    } else {
        // `<noop/>` is ASCII, so every prefix length is a char boundary.
        (1..NOOP_SIGNAL.len())
            .rev()
            .find(|&length| text.ends_with(&NOOP_SIGNAL[..length]))
            .map_or(text.len(), |length| text.len() - length)
    };
    text[..tag_start].trim_end().len()
}
