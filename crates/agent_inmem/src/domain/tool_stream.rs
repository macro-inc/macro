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

use nom::branch::alt;
use nom::bytes::complete::take_while1;
use nom::character::complete::{anychar, char, one_of};
use nom::combinator::{consumed, iterator, map, opt, recognize};
use nom::multi::many0;
use nom::{IResult, Parser};
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
    over_limit: bool,
    last_peek: Option<Instant>,
    peeked: Option<Value>,
}

impl StreamingCalls {
    /// The model named call `id`; its arguments follow.
    pub fn open(&mut self, id: &str) {
        if let std::collections::hash_map::Entry::Vacant(entry) = self.calls.entry(id.to_owned()) {
            entry.insert(StreamingCall::default());
            self.order.push(id.to_owned());
        }
    }

    /// Take in a fragment of call `id`'s arguments; returns the peek to send,
    /// if one is due and says something the last one did not.
    pub fn push_arguments(&mut self, id: &str, delta: &str, now: Instant) -> Option<Value> {
        let call = self.calls.get_mut(id)?;
        if call.over_limit {
            return None;
        }
        if delta.len() > PEEK_LIMIT.saturating_sub(call.arguments.len()) {
            call.over_limit = true;
            call.arguments.clear();
            return None;
        }
        call.arguments.push_str(delta);
        if call
            .last_peek
            .is_some_and(|at| now.saturating_duration_since(at) < PEEK_WINDOW)
        {
            return None;
        }
        call.last_peek = Some(now);
        let peek = peek_arguments(&call.arguments).filter(|peek| !peek.is_empty())?;
        let peek = Value::Object(peek);
        if call.peeked.as_ref() == Some(&peek) {
            return None;
        }
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
    let mut tokens = iterator(prefix, consumed(json_token));
    let mut at = 0;
    for (raw, token) in &mut tokens {
        match token {
            JsonToken::String {
                open,
                trailing_escape,
            } => {
                in_string = open;
                escaped = trailing_escape;
            }
            JsonToken::Symbol('{') => closers.push('}'),
            JsonToken::Symbol('[') => closers.push(']'),
            JsonToken::Symbol('}' | ']') => {
                closers.pop();
            }
            JsonToken::Symbol(',') => {
                if cuts.len() == PEEK_CUTS {
                    cuts.remove(0);
                }
                cuts.push((at, closers.clone()));
            }
            _ => {}
        }
        at += raw.len();
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

/// A JSON token, allowing the final string to be incomplete.
enum JsonToken {
    String { open: bool, trailing_escape: bool },
    Symbol(char),
    Other,
}

fn json_token(input: &str) -> IResult<&str, JsonToken> {
    alt((
        map(
            (
                char('"'),
                many0(alt((
                    recognize((char('\\'), anychar)),
                    take_while1(|ch| ch != '"' && ch != '\\'),
                ))),
                opt(char('\\')),
                opt(char('"')),
            ),
            |(_, _, escape, close)| JsonToken::String {
                open: close.is_none(),
                trailing_escape: escape.is_some(),
            },
        ),
        map(one_of("{}[],"), JsonToken::Symbol),
        map(take_while1(|ch| !"\"{}[],".contains(ch)), |_| {
            JsonToken::Other
        }),
    ))
    .parse(input)
}
