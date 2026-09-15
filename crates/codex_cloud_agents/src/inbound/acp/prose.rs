//! Replaceable provisional prose for clients that advertise keyed text updates.

use super::{chunk, citations};
use crate::domain::cloud::CloudEvent;
use agent_client_protocol::schema::v1::SessionUpdate;
use agent_runtime_protocol::domain::text_replace::text_replace_meta;

#[derive(Default)]
pub(super) struct Prose {
    messages: Vec<Message>,
    finished: bool,
    poll_fragments: Vec<(String, String)>,
    poll_position: Option<usize>,
}

struct Message {
    id: String,
    text: String,
    complete: bool,
}

fn replacement(id: &str, text: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(chunk(&citations::markdown(text)).meta(text_replace_meta(id)))
}

impl Prose {
    pub(super) fn project(&mut self, event: &CloudEvent) -> Vec<SessionUpdate> {
        if event.method == "user/message" {
            *self = Self::default();
            return Vec::new();
        }
        if event.method == "session/turn_complete" {
            self.finished = true;
            // A final snapshot can lack native item IDs. Remove any remaining
            // unverified fragments after its complete messages have been projected.
            return self
                .messages
                .iter_mut()
                .filter_map(|message| {
                    if message.complete || message.text.is_empty() {
                        return None;
                    }
                    message.text.clear();
                    Some(replacement(&message.id, ""))
                })
                .collect();
        }
        if self.finished {
            return Vec::new();
        }
        let delta = event.method == "item/agentMessage/delta";
        let complete = event.method == "item/completed";
        let lifecycle = matches!(event.method.as_str(), "item/started" | "item/completed")
            && event.params["item"]["type"] == "agentMessage";
        if !(delta || lifecycle) {
            return Vec::new();
        }
        let (id, text) = if delta {
            (
                event.params["itemId"].as_str(),
                event.params["delta"].as_str(),
            )
        } else {
            (
                event.params["item"]["id"].as_str(),
                event.params["item"]["text"].as_str(),
            )
        };
        let Some(id) = id.filter(|id| !id.is_empty()) else {
            return Vec::new();
        };
        let text = text.unwrap_or("");
        if complete && id.starts_with("poll-message:") {
            return self.poll_message(id, text);
        }
        let position = self.messages.iter().position(|message| message.id == id);
        let position = position.unwrap_or_else(|| {
            self.messages.push(Message {
                id: id.into(),
                text: String::new(),
                complete: false,
            });
            self.messages.len() - 1
        });
        let message = &mut self.messages[position];
        if message.complete && !complete {
            return Vec::new();
        }
        let previous = message.text.clone();
        if delta {
            message.text.push_str(text);
        } else {
            message.text = text.into();
            message.complete = complete;
        }
        if previous == message.text {
            return Vec::new();
        }
        vec![replacement(&message.id, &message.text)]
    }
    fn poll_message(&mut self, id: &str, text: &str) -> Vec<SessionUpdate> {
        if let Some((_, previous)) = self.poll_fragments.iter_mut().find(|(key, _)| key == id) {
            *previous = text.into();
        } else {
            self.poll_fragments.push((id.into(), text.into()));
        }
        // A snapshot exposes text fragments, not native item identities. Keep
        // them together in one stable slot and clear other partial slots at EOF.
        let position = *self.poll_position.get_or_insert_with(|| {
            self.messages
                .iter()
                .position(|message| !message.complete)
                .unwrap_or_else(|| {
                    self.messages.push(Message {
                        id: id.into(),
                        text: String::new(),
                        complete: false,
                    });
                    self.messages.len() - 1
                })
        });
        let text = self
            .poll_fragments
            .iter()
            .map(|(_, text)| text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let message = &mut self.messages[position];
        message.complete = true;
        if message.text == text {
            return Vec::new();
        }
        message.text = text;
        vec![replacement(&message.id, &message.text)]
    }
}

#[cfg(test)]
mod test;
