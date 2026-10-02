//! Database discovery, authoring, and verification behavior shared across agent hosts.

use crate::types::StaticPrompt;

/// Instructions for tools that operate on Macro databases.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Macro databases",
    include_str!("databases.md"),
    "Find nested tables before claiming absence, use real schema and entity ids, carry out requested database changes with the schema tools, verify persisted results, and answer data questions with live saved-query blocks.",
);

#[cfg(test)]
mod test;
