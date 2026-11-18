//! Privacy requirements for persistent, potentially shared professional context.
use crate::StaticPrompt;

/// Applied to memory generators. The memory judge asks these rules as Jev
/// questions (`memory::outbound::jev_judge::Rule`); change both together.
pub static PROMPT: StaticPrompt = StaticPrompt::borrowed(
    "Memory privacy",
    include_str!("privacy.md"),
    "Keep only professional context that is safe to retain and share with teammates.",
);
