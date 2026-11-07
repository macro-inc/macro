//! Scripts: what the emulator answers, and how a request picks its reply.

use std::collections::BTreeMap;

use lazy_regex::regex;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a request with no script, or with no tools to call, is answered.
pub const DEFAULT_REPLY: &str = "OK.";

/// A script's name: letters, digits, `.`, `_` and `-`, as the marker
/// `[[script:<name>]]` spells it.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ScriptName(String);

impl TryFrom<String> for ScriptName {
    type Error = ScriptError;

    fn try_from(name: String) -> Result<Self, Self::Error> {
        if regex!(r"^[A-Za-z0-9._-]+$").is_match(&name) {
            Ok(Self(name))
        } else {
            Err(ScriptError::Name(name))
        }
    }
}

impl From<ScriptName> for String {
    fn from(name: ScriptName) -> Self {
        name.0
    }
}

impl std::fmt::Display for ScriptName {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The model's side of one conversation, decided ahead of time.
///
/// A request belongs to the script its last user message names with
/// `[[script:<name>]]`. The model turns that follow that message in the
/// request say how far the conversation is: the first request is answered
/// `replies[0]`, the one that carries its tool results `replies[1]`, and so
/// on. A request past the last reply is answered [`DEFAULT_REPLY`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Script {
    /// The model's turns, in order.
    pub replies: Vec<Reply>,
    /// Values a reply takes from the request: each is a regular expression
    /// with one group, matched against the text of the request's messages,
    /// and its last match replaces `{{<name>}}` in the reply's text and tool
    /// arguments.
    #[serde(default)]
    pub captures: BTreeMap<String, String>,
}

/// One turn of the model: text, tool calls, or both.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    /// What the model says.
    #[serde(default)]
    pub text: Option<String>,
    /// The tools the model calls, in order.
    #[serde(default)]
    pub calls: Vec<ToolCall>,
}

/// A tool call of the model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    /// The tool's name, as the request declares it.
    pub name: String,
    /// The call's arguments, a JSON object.
    pub args: Value,
}

/// Why a script was refused.
#[derive(Debug, thiserror::Error)]
pub enum ScriptError {
    /// The name has a character the marker cannot carry.
    #[error("a script's name is letters, digits, '.', '_' and '-': {0:?}")]
    Name(String),
    /// A capture is not a regular expression with exactly one group.
    #[error("the capture {name:?} is not a regular expression with one group")]
    Capture {
        /// The capture's name.
        name: String,
        /// What the expression's compiler said, when it did not compile.
        #[source]
        source: Option<regex::Error>,
    },
}

/// A script with its captures compiled.
pub(crate) struct StoredScript {
    replies: Vec<Reply>,
    captures: Vec<(String, Regex)>,
}

impl TryFrom<Script> for StoredScript {
    type Error = ScriptError;

    fn try_from(script: Script) -> Result<Self, Self::Error> {
        let mut captures = Vec::with_capacity(script.captures.len());
        for (name, expression) in script.captures {
            let compiled = match Regex::new(&expression) {
                Ok(compiled) if compiled.captures_len() == 2 => compiled,
                Ok(_) => return Err(ScriptError::Capture { name, source: None }),
                Err(source) => {
                    return Err(ScriptError::Capture {
                        name,
                        source: Some(source),
                    });
                }
            };
            captures.push((name, compiled));
        }
        Ok(Self {
            replies: script.replies,
            captures,
        })
    }
}

/// The script a request names and how far its conversation is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Place {
    pub(crate) script: ScriptName,
    /// The model turns in the request after the message naming the script.
    pub(crate) reply: usize,
}

/// The texts of a request's messages (`contents[].parts[].text`), by message.
fn texts(body: &Value) -> impl Iterator<Item = (&Value, &str)> {
    body.get("contents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|content| {
            content
                .get("parts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .map(move |text| (content, text))
        })
}

fn is_model(content: &Value) -> bool {
    content.get("role").and_then(Value::as_str) == Some("model")
}

/// Where a GenerateContent request is in a script, if it names one and
/// offers tools. A request without tools (a title, a summary) quotes the
/// user's message without being part of the conversation.
pub(crate) fn place(body: &Value) -> Option<Place> {
    let offers_tools = body
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty());
    if !offers_tools {
        return None;
    }

    let contents = body.get("contents").and_then(Value::as_array)?;
    let marker = regex!(r"\[\[script:([A-Za-z0-9._-]+)\]\]");
    let (named_at, name) = contents
        .iter()
        .enumerate()
        .filter(|(_, content)| !is_model(content))
        .filter_map(|(index, content)| {
            let parts = content.get("parts").and_then(Value::as_array)?;
            let name = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .filter_map(|text| marker.captures_iter(text).last())
                .last()?;
            Some((index, name.get(1)?.as_str().to_owned()))
        })
        .next_back()?;

    Some(Place {
        script: ScriptName::try_from(name).ok()?,
        reply: contents
            .iter()
            .skip(named_at + 1)
            .filter(|content| is_model(content))
            .count(),
    })
}

impl StoredScript {
    /// The reply at `index` with the request's captured values filled in,
    /// or nothing past the last reply.
    pub(crate) fn reply(&self, index: usize, body: &Value) -> Option<Reply> {
        let reply = self.replies.get(index)?;
        let values: Vec<(String, &str)> = self
            .captures
            .iter()
            .filter_map(|(name, expression)| {
                let value = texts(body)
                    .filter_map(|(_, text)| expression.captures_iter(text).last())
                    .last()?
                    .get(1)?
                    .as_str();
                Some((format!("{{{{{name}}}}}"), value))
            })
            .collect();

        let fill = |text: &str| {
            values
                .iter()
                .fold(text.to_owned(), |text, (placeholder, value)| {
                    text.replace(placeholder, value)
                })
        };
        Some(Reply {
            text: reply.text.as_deref().map(fill),
            calls: reply
                .calls
                .iter()
                .map(|call| ToolCall {
                    name: call.name.clone(),
                    args: filled(&call.args, &fill),
                })
                .collect(),
        })
    }
}

/// `value` with every string in it passed through `fill`.
fn filled(value: &Value, fill: &impl Fn(&str) -> String) -> Value {
    match value {
        Value::String(text) => Value::String(fill(text)),
        Value::Array(items) => Value::Array(items.iter().map(|item| filled(item, fill)).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), filled(value, fill)))
                .collect(),
        ),
        other => other.clone(),
    }
}
