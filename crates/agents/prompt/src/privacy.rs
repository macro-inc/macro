//! Privacy requirements for persistent, potentially shared professional context.
use crate::StaticPrompt;

/// Applied to generators and the final memory judge.
pub static PROMPT: StaticPrompt = StaticPrompt::borrowed(
    "Memory privacy",
    include_str!("privacy.md"),
    "Keep only professional context that is safe to retain and share with teammates.",
);
