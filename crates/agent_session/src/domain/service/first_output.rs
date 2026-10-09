//! Which live frames should bypass the log's publication timer.

use agent_fold::domain::model::{Author, Control, FoldEvent, MessagePart, OwnedFoldEvent, TurnId};

/// Keep the beginning of prose responsive across small provider chunks. A
/// numbered-list marker, bold delimiter, or code-fence language can arrive
/// before any readable words; stopping at the first nonempty chunk strands
/// those words behind the regular batching interval.
const INITIAL_TEXT_CHARS: usize = 64;

/// Publish the first output and a bounded burst of initial prose promptly.
/// Subsequent chunks and replay retain the regular batching interval.
#[derive(Default)]
pub(super) struct FirstOutput {
    turn: Option<TurnId>,
    output_seen: bool,
    text_chars: usize,
}

impl FirstOutput {
    pub(super) fn observe(&mut self, events: &[OwnedFoldEvent]) -> bool {
        let mut flush = false;
        for event in events {
            match event {
                FoldEvent::NewMessage(message)
                    if matches!(message.author, Author::User { .. })
                        && message.parts.iter().any(|part| {
                            matches!(
                                part,
                                MessagePart::Text { .. }
                                    | MessagePart::Attachment { .. }
                                    | MessagePart::Control {
                                        control: Control::Compact,
                                        ..
                                    }
                            )
                        }) =>
                {
                    *self = Self {
                        turn: Some(message.id),
                        ..Self::default()
                    };
                }
                FoldEvent::NewMessage(message) | FoldEvent::MessageUpdate(message)
                    if matches!(message.author, Author::Agent)
                        && self.turn == Some(message.id)
                        && self.text_chars < INITIAL_TEXT_CHARS =>
                {
                    let text_chars = message
                        .parts
                        .iter()
                        .filter_map(|part| match part {
                            MessagePart::Text { text } => Some(text.chars()),
                            _ => None,
                        })
                        .flatten()
                        .filter(|character| !character.is_whitespace())
                        .take(INITIAL_TEXT_CHARS)
                        .count();
                    let output = message.parts.iter().any(|part| match part {
                        MessagePart::Text { text } | MessagePart::Thought { text } => {
                            !text.trim().is_empty()
                        }
                        _ => true,
                    });
                    flush |= (!self.output_seen && output) || text_chars > self.text_chars;
                    self.output_seen |= output;
                    self.text_chars = text_chars;
                }
                // The fold stages session/load replay and replaces history at
                // the boundary. Old answers must not trigger live flushes.
                FoldEvent::MessagesReplaced(_) => *self = Self::default(),
                _ => {}
            }
        }
        flush
    }
}
