//! What a persona remembers, as its sessions read it.

#[cfg(test)]
mod test;

/// Introduces the persona's memory to the agent: whose it is, and how to
/// change it.
pub const PERSONA_MEMORY_HEADING: &str = include_str!("persona_memory/heading.md");

/// `instructions` followed by the persona's `memory`, when it has any.
#[must_use]
pub fn with_persona_memory(instructions: Option<&str>, memory: Option<&str>) -> Option<String> {
    let memory = memory
        .map(str::trim)
        .filter(|memory| !memory.is_empty())
        .map(|memory| format!("{}\n\n{memory}", PERSONA_MEMORY_HEADING.trim()));
    let sections: Vec<&str> = instructions.into_iter().chain(memory.as_deref()).collect();
    (!sections.is_empty()).then(|| sections.join("\n\n"))
}
