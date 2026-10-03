//! Tool calls while the model is still writing them.
//!
//! A call opens `pending` the moment the model names it, so it takes its row
//! in the transcript's live tool window instead of appearing whole seconds
//! later. While its arguments stream, the reader gets a peek at them: the
//! prefix received so far, closed into a JSON object, sent as the call's
//! `rawInput`. Peeks go out at most once per [`PEEK_WINDOW`] - every frame is
//! logged, and a long argument can arrive in thousands of fragments - and
//! stop past [`PEEK_LIMIT`], where each one would carry a large prefix again.
//! The finished call replaces the last peek with the real arguments.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

#[cfg(test)]
mod test;

/// The shortest gap between two peeks at one call's arguments.
pub const PEEK_WINDOW: Duration = Duration::from_millis(250);

/// Arguments longer than this are no longer peeked at; the call shows its
/// last peek until it finishes.
pub const PEEK_LIMIT: usize = 16 * 1024;

/// How many of the latest `,` boundaries a peek falls back to when the
/// prefix does not close into JSON as it stands.
const PEEK_CUTS: usize = 4;

/// The turn's calls that have opened and not finished.
#[derive(Default)]
pub struct StreamingCalls {
    calls: HashMap<String, StreamingCall>,
    /// Open order, so calls left open at the end of a turn close in order.
    order: Vec<String>,
}

#[derive(Default)]
struct StreamingCall {
    arguments: String,
    last_peek: Option<Instant>,
    peeked: Option<Value>,
}

impl StreamingCalls {
    /// The model named call `id`; its arguments follow.
    pub fn open(&mut self, id: &str) {
        if self
            .calls
            .insert(id.to_owned(), StreamingCall::default())
            .is_none()
        {
            self.order.push(id.to_owned());
        }
    }

    /// Take in a fragment of call `id`'s arguments; returns the peek to send,
    /// if one is due and says something the last one did not.
    pub fn push_arguments(&mut self, id: &str, delta: &str, now: Instant) -> Option<Value> {
        let call = self.calls.get_mut(id)?;
        if call.arguments.len() > PEEK_LIMIT {
            return None;
        }
        call.arguments.push_str(delta);
        if call.arguments.len() > PEEK_LIMIT
            || call
                .last_peek
                .is_some_and(|at| now.saturating_duration_since(at) < PEEK_WINDOW)
        {
            return None;
        }
        let peek = peek_arguments(&call.arguments).filter(|peek| !peek.is_empty())?;
        let peek = Value::Object(peek);
        if call.peeked.as_ref() == Some(&peek) {
            return None;
        }
        call.last_peek = Some(now);
        call.peeked = Some(peek.clone());
        Some(peek)
    }

    /// Call `id` finished; whether it had opened early.
    pub fn finish(&mut self, id: &str) -> bool {
        self.order.retain(|open| open != id);
        self.calls.remove(id).is_some()
    }

    /// The calls that opened and never finished, oldest first.
    pub fn into_unfinished(self) -> Vec<String> {
        self.order
    }
}

/// The object a prefix of streamed JSON arguments says so far.
///
/// Open strings, arrays and objects are closed where the prefix stops; a
/// prefix that does not close into JSON that way - it ends inside a key, or
/// after one - falls back to its last complete member. `None` when nothing
/// complete has arrived yet.
#[must_use]
pub fn peek_arguments(prefix: &str) -> Option<Map<String, Value>> {
    let mut closers: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut cuts: Vec<(usize, Vec<char>)> = Vec::new();
    for (at, ch) in prefix.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => closers.push('}'),
            '[' => closers.push(']'),
            '}' | ']' => {
                closers.pop();
            }
            ',' => {
                if cuts.len() == PEEK_CUTS {
                    cuts.remove(0);
                }
                cuts.push((at, closers.clone()));
            }
            _ => {}
        }
    }

    let mut whole = prefix.to_owned();
    if in_string {
        if escaped {
            whole.pop();
        }
        whole.push('"');
    }
    std::iter::once((whole, closers))
        .chain(
            cuts.into_iter()
                .rev()
                .map(|(at, closers)| (prefix[..at].to_owned(), closers)),
        )
        .find_map(|(mut attempt, closers)| {
            attempt.extend(closers.iter().rev());
            match serde_json::from_str(&attempt) {
                Ok(Value::Object(object)) => Some(object),
                _ => None,
            }
        })
}
