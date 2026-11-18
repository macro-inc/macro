//! Where a turn's SDK documentation sits in its context: on the user message
//! that asked for it, not in the system prompt.
//!
//! Each turn picks different documentation. In the system prompt it came
//! before the history, so every new turn changed the prompt ahead of the
//! whole conversation and the provider's cache missed it. On its request's
//! message, a turn changes only what follows the previous one. A session
//! remembers what each request received so later turns repeat it in place.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Mutex, PoisonError};

use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent_session::domain::model::AgentSessionId;
use tokio::time::Instant;

use crate::domain::skill_routing::SESSION_IDLE;

#[cfg(test)]
mod test;

/// Most documentation one session's context carries, in bytes, beyond its
/// newest request's. A turn whose documentation would go past it drops every
/// earlier request's at once, so the cache misses from the oldest of them
/// on that turn only, and the next miss waits until the budget fills again.
/// A turn picks about 20 KiB at the median and 37 KiB at p90, so that is
/// every few turns, not once a session. The newest request always keeps its
/// own whole, however large: the selector bounds it (48 KiB of indexes, plus
/// the catalog and any attached skill), and that turn needs it.
pub const DOCS_PER_SESSION_BYTES: usize = 64 * 1024;

/// The documentation each session's requests received. Kept in memory: after
/// a restart earlier requests go without theirs, and the next turn's
/// documentation still arrives.
#[derive(Default)]
pub struct SessionDocs {
    sessions: Mutex<HashMap<AgentSessionId, Received>>,
}

struct Received {
    touched: Instant,
    docs: Vec<Entry>,
}

/// One request's documentation, with the request it belongs to: its place
/// among the user messages and a hash of its text.
struct Entry {
    request: usize,
    text: u64,
    docs: String,
}

impl SessionDocs {
    /// Record that the last of `requests` (the session's user messages, in
    /// order) received `docs` and return each request's documentation, by
    /// request, oldest first.
    ///
    /// An entry whose request is no longer where it was (a summary replaced
    /// it, or the conversation was cleared) is forgotten. Documentation the
    /// latest earlier request already holds is not repeated, and a request
    /// that runs again replaces what it received. Forgets sessions idle for
    /// [`SESSION_IDLE`].
    pub fn add(
        &self,
        session: AgentSessionId,
        requests: &[String],
        docs: String,
    ) -> Vec<(usize, String)> {
        let Some((request, request_text)) = requests.len().checked_sub(1).zip(requests.last())
        else {
            return Vec::new();
        };
        let now = Instant::now();
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions.retain(|_, received| now.duration_since(received.touched) < SESSION_IDLE);
        let received = sessions.entry(session).or_insert_with(|| Received {
            touched: now,
            docs: Vec::new(),
        });
        received.touched = now;
        received.docs.retain(|entry| {
            entry.request < request
                && requests.get(entry.request).map(|text| hash(text)) == Some(entry.text)
        });

        let repeated = received
            .docs
            .last()
            .is_some_and(|latest| latest.docs == docs);
        if !docs.is_empty() && !repeated {
            let held: usize = received.docs.iter().map(|entry| entry.docs.len()).sum();
            if held + docs.len() > DOCS_PER_SESSION_BYTES {
                tracing::info!(
                    agent_session_id = %session,
                    dropped_entries = received.docs.len(),
                    dropped_bytes = held,
                    "sdk docs budget full; earlier requests' documentation dropped"
                );
                received.docs.clear();
            }
            received.docs.push(Entry {
                request,
                text: hash(request_text),
                docs,
            });
        }
        received
            .docs
            .iter()
            .map(|entry| (entry.request, entry.docs.clone()))
            .collect()
    }
}

fn hash(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// Append each request's documentation to its user message. Only the model's
/// copy of the context changes; the session log keeps what the user wrote.
pub fn inject(messages: &mut [ChatMessage], docs: &[(usize, String)]) {
    let requests = messages
        .iter_mut()
        .filter(|message| message.role == Role::User)
        .enumerate();
    for (request, message) in requests {
        let Some((_, text)) = docs.iter().find(|(at, _)| *at == request) else {
            continue;
        };
        if let ChatMessageContent::Text(content) = &mut message.content {
            content.push('\n');
            content.push_str(text);
        }
    }
}
