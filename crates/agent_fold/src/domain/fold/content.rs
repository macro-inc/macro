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

    /// Append agent prose, extending the trailing text part when there is one.
    pub(super) fn append_text(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Text { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Text { text })
            .map(|(changed, _)| changed)
    }

    /// Append agent reasoning, extending the trailing thought part when there
    /// is one.
    pub(super) fn append_thought(&mut self, text: String) -> Option<Changed> {
        if let Some((message, parts)) = self.agent_parts_mut()
            && let MessagePart::Thought { text: existing } = parts.last_mut()
        {
            existing.push_str(&text);
            return Some(Changed::updated(message));
        }
        self.push_agent_part(MessagePart::Thought { text })
            .map(|(changed, _)| changed)
    }

    /// Add a part to the open turn's agent message, creating that message if
    /// this is the first part the agent has produced in the turn - and the
    /// turn itself if the agent is talking without one.
    ///
    /// Every way the agent contributes content comes through here, which is
    /// why opening the turn belongs here rather than in each caller.
    pub(super) fn push_agent_part(&mut self, part: MessagePart) -> Option<(Changed, usize)> {
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
            });
            self.open_turn().agent = Some(message);
            return Some((Changed::new(message), 0));
        };

        let parts = &mut self.messages[message].parts;
        let position = parts.len();
        parts.push(part);
        Some((Changed::updated(message), position))
    }

    /// The open turn's agent message: where it sits in [`State::messages`],
    /// and its parts. `None` until the agent has produced a part.
    pub(super) fn agent_parts_mut(&mut self) -> Option<(usize, &mut NonEmpty<Vec<MessagePart>>)> {
        let message = self.turn.as_ref()?.agent?;
        Some((message, &mut self.messages[message].parts))
    }
}
