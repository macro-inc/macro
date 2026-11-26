//! Loading and calling a connection's tools the way an agent does: open an
//! agent session whose first prompt asks the agent to list one app's tools
//! and call one, then read what it reports from the session's folded log.

use std::time::Duration;

use rootcause::prelude::*;
use serde_json::Value;
use tokio::time::Instant;
use uuid::Uuid;

use crate::Report;
use crate::api::Account;

#[cfg(test)]
mod test;

/// How long an agent's turn may take: the session's sandbox starts first.
const TURN_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How often the session's log is read while the turn runs.
const CHECK_EVERY: Duration = Duration::from_secs(10);
/// The word the agent's report line starts with.
const MARKER: &str = "CONNECTORS-E2E";
/// How much of an agent's reply a failure shows.
const SHOWN: usize = 2_000;

/// What the agent reported after using one app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentReport {
    /// How many tools the app offered.
    pub tools: u32,
    /// The tool it called.
    pub called: String,
    /// Whether the call succeeded.
    pub ok: bool,
    /// How many tool calls the agent's reply shows: at least the listing and
    /// the call.
    pub tool_calls: usize,
}

/// The prompt that asks the agent to use the connected app `name`, and to
/// report under `nonce`.
pub(crate) fn prompt(name: &str, nonce: Uuid) -> String {
    format!(
        "This is an automated check of connected apps. Use only the connected app \
         \"{name}\": load its tools, then call one tool of it that only reads and needs no \
         arguments, or only optional ones. Do not change anything in the app and do not \
         ask me anything. Then end your reply with exactly one line of this form and \
         nothing after it:\n\
         {MARKER} {nonce} tools=<how many tools the app offered> called=<the tool's name> \
         ok=<true if the call succeeded, false otherwise>"
    )
}

/// The report line for `nonce` in `text`, if there is one.
pub fn parse_report(text: &str, nonce: Uuid) -> Option<(u32, String, bool)> {
    let pattern = lazy_regex::regex!(
        r"CONNECTORS-E2E\s+([0-9a-fA-F-]{36})\s+tools=(\d+)\s+called=`?([^\s`]+)`?\s+ok=(true|false)"
    );
    pattern.captures_iter(text).find_map(|captures| {
        let reported = Uuid::parse_str(captures.get(1)?.as_str()).ok()?;
        if reported != nonce {
            return None;
        }
        let tools = captures.get(2)?.as_str().parse().ok()?;
        let called = captures.get(3)?.as_str().to_owned();
        let ok = captures.get(4)?.as_str() == "true";
        Some((tools, called, ok))
    })
}

impl Account {
    /// Ask an agent to load the connected app `name`'s tools and call one,
    /// and answer what it reported. The session is archived afterwards.
    pub async fn use_app_through_agent(&self, name: &str) -> Result<AgentReport, Report> {
        let nonce = Uuid::now_v7();
        let session = self.open_session(&prompt(name, nonce)).await?;
        let outcome = self.await_report(session, nonce).await;
        let archived = self.archive_session(session).await;
        let report = outcome.attach(format!("agent session {session}"))?;
        archived?;
        Ok(report)
    }

    /// Read the session's log until the agent's turn ends, then find its
    /// report.
    ///
    /// The agent runs in another service, observed only through its log,
    /// so nothing here can be signalled when the turn ends; reading the log
    /// again is the only way to know.
    async fn await_report(&self, session: Uuid, nonce: Uuid) -> Result<AgentReport, Report> {
        let started = Instant::now();
        loop {
            let messages = self.session_messages(session).await?;
            let replies: Vec<&Value> = messages
                .iter()
                .filter(|message| is_agent(message))
                .collect();
            if let Some(last) = replies.last()
                && last.get("stop").is_some_and(|stop| !stop.is_null())
            {
                let text: String = replies.iter().map(|reply| text_of(reply)).collect();
                let tool_calls = replies.iter().map(|reply| tool_calls_of(reply)).sum();
                let Some((tools, called, ok)) = parse_report(&text, nonce) else {
                    bail!(
                        "the agent's turn ended without its report line; it said: {}",
                        shorten(&text)
                    );
                };
                return Ok(AgentReport {
                    tools,
                    called,
                    ok,
                    tool_calls,
                });
            }
            if started.elapsed() > TURN_TIMEOUT {
                bail!("timed out waiting for the agent's turn to end");
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    }
}

fn is_agent(message: &Value) -> bool {
    message.pointer("/author/kind").and_then(Value::as_str) == Some("agent")
}

fn parts(message: &Value) -> impl Iterator<Item = &Value> {
    message
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn text_of(message: &Value) -> String {
    parts(message)
        .filter(|part| part.get("kind").and_then(Value::as_str) == Some("text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .fold(String::new(), |mut text, part| {
            text.push_str(part);
            text.push('\n');
            text
        })
}

fn tool_calls_of(message: &Value) -> usize {
    parts(message)
        .filter(|part| part.get("kind").and_then(Value::as_str) == Some("tool_use"))
        .count()
}

fn shorten(text: &str) -> &str {
    let end = text
        .char_indices()
        .map(|(index, _)| index)
        .nth(SHOWN)
        .unwrap_or(text.len());
    &text[..end]
}
