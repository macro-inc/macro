use super::*;

#[test]
fn no_memory_leaves_instructions_unchanged() {
    assert_eq!(
        with_persona_memory(Some("Persona."), None),
        Some("Persona.".to_owned())
    );
    assert_eq!(with_persona_memory(None, None), None);
}

#[test]
fn memory_follows_the_instructions() {
    assert_eq!(
        with_persona_memory(Some("Persona."), Some("- The team ships on Thursdays.")),
        Some(format!(
            "Persona.\n\n{}\n\n- The team ships on Thursdays.",
            PERSONA_MEMORY_HEADING.trim()
        ))
    );
}

#[test]
fn memory_stands_alone_without_instructions() {
    assert_eq!(
        with_persona_memory(None, Some("- Reply in French.")),
        Some(format!(
            "{}\n\n- Reply in French.",
            PERSONA_MEMORY_HEADING.trim()
        ))
    );
}
