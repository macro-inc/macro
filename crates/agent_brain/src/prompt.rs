//! Build the prompt for one turn: the agent's own instructions, then the
//! messages to consider, then recent history, as Markdown sections.

use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};

#[cfg(test)]
mod test;

/// Heading of the batch section.
pub const MESSAGES_HEADING: &str =
    "## Messages to consider (all in one conversation; answer them together)";
/// Heading of the history section.
pub const HISTORY_HEADING: &str = "## Recent history of this conversation";

/// A turn prompt under construction.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnPrompt {
    parts: Vec<String>,
}

impl TurnPrompt {
    /// Start with the agent's instructions (e.g. the contents of
    /// `prompts/respond.md`).
    pub fn new(instructions: impl Into<String>) -> Self {
        Self {
            parts: vec![instructions.into().trim_end().to_owned()],
        }
    }

    /// Start with the contents of an instructions file.
    pub async fn from_file(path: &Path) -> Result<Self> {
        let text = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| Error::io("read", path, e))?;
        Ok(Self::new(text))
    }

    /// Add a section with a `## heading` (pass the full heading line) and a
    /// free-text body.
    pub fn section(mut self, heading: impl Into<String>, body: impl AsRef<str>) -> Self {
        self.parts.push(heading.into());
        let body = body.as_ref().trim_end();
        self.parts.push(if body.is_empty() {
            "(none)".to_owned()
        } else {
            body.to_owned()
        });
        self
    }

    /// Add a section listing items, one JSON object per line.
    pub fn json_lines<T: Serialize>(self, heading: impl Into<String>, items: &[T]) -> Result<Self> {
        let mut lines = Vec::with_capacity(items.len());
        for item in items {
            lines.push(serde_json::to_string(item).map_err(|e| Error::json("a prompt item", e))?);
        }
        Ok(self.section(heading, lines.join("\n")))
    }

    /// Add the batch of messages to answer.
    pub fn messages<T: Serialize>(self, batch: &[T]) -> Result<Self> {
        self.json_lines(MESSAGES_HEADING, batch)
    }

    /// Add the conversation's recent history.
    pub fn history<T: Serialize>(self, history: &[T]) -> Result<Self> {
        self.json_lines(HISTORY_HEADING, history)
    }

    /// The finished prompt.
    pub fn build(self) -> String {
        let mut text = self.parts.join("\n\n");
        text.push('\n');
        text
    }
}
