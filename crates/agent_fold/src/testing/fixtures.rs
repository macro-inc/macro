//! Protocol log fixtures shared by this crate and downstream tests.

/// A hand-shaped complete turn with prose, tools, permission, and a clean stop.
pub const TURN: &str = include_str!("../../fixtures/turn.jsonl");

/// A sanitized real resumed session followed by fresh prompts.
pub const RESUMED_AND_CONTINUED: &str =
    include_str!("../../fixtures/real/resumed_and_continued.jsonl");

/// A sanitized real resumed session whose prompt is absent from this log.
pub const RESUMED_NO_PROMPT: &str = include_str!("../../fixtures/real/resumed_no_prompt.jsonl");

/// A long sanitized recording containing several resumes.
pub const LONG_MULTI_RESUME: &str = include_str!("../../fixtures/real/long_multi_resume.jsonl");

/// A sanitized real turn containing repeated plan updates.
pub const PLAN_TODO: &str = include_str!("../../fixtures/real/plan_todo.jsonl");
