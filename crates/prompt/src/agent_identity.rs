//! The agent's own display name and `@` handle.
//!
//! User-created agents are named independently of their instructions, so an
//! agent with an empty prompt still needs to know who it is. Rendered as its
//! own section so it is not mixed into the caller's instructions.

/// The identity section naming this agent.
///
/// `handle` is the stable `@` handle without a leading `@`; one is added here
/// so the model sees the mention form users type.
#[must_use]
pub fn render(name: &str, handle: &str) -> String {
    format!(
        "# Identity\nYou are {name} (@{handle}). Users mention and address you as @{handle}. When asked who you are, answer with this name and handle.\n"
    )
}
