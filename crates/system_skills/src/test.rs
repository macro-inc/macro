use super::*;

#[test]
fn system_skill_slugs_and_ids_are_unique() {
    let mut slugs: Vec<&str> = SYSTEM_SKILLS.iter().map(|skill| skill.slug).collect();
    slugs.sort();
    slugs.dedup();
    assert_eq!(slugs.len(), SYSTEM_SKILLS.len());

    let mut ids: Vec<Uuid> = SYSTEM_SKILLS.iter().map(|skill| skill.id()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), SYSTEM_SKILLS.len());
}

#[test]
fn ids_are_stable_uuidv5_derivations() {
    for skill in SYSTEM_SKILLS {
        let expected = Uuid::new_v5(&SYSTEM_SKILL_NAMESPACE, skill.slug.as_bytes());
        assert_eq!(skill.id(), expected);
        assert_eq!(skill.id().get_version(), Some(uuid::Version::Sha1));
    }
}

#[test]
fn lookup_finds_registered_skills() {
    for skill in SYSTEM_SKILLS {
        let found = system_skill(skill.id()).expect("registered skill should be found");
        assert_eq!(found.name, skill.name);
        assert!(is_system_skill(skill.id()));
    }
}

#[test]
fn unknown_id_is_not_a_system_skill() {
    assert!(!is_system_skill(Uuid::nil()));
    assert!(system_skill(Uuid::nil()).is_none());
}

#[test]
fn skills_render_non_empty_titled_markdown() {
    for skill in SYSTEM_SKILLS {
        let content = skill.render_content();
        assert!(!content.trim().is_empty());
        // StaticPrompt renders as a markdown section titled with the name.
        assert!(content.starts_with(&format!("# {}", skill.name)));
    }
}

/// The Compose Routines skill ends with the text every writer of routines
/// follows, whole, so a chat session and the drafter write by the same rules.
#[test]
fn compose_routines_carries_the_shared_writing_text() {
    let content = compose_routines::SKILL.render_content();
    assert!(content.contains(routine_program::WRITING));
    for rule in [
        "one `macro.search.names([...])` call",
        "macro.routines.check(routine, { created })",
        "## Without code",
    ] {
        assert!(content.contains(rule), "{rule}");
    }
}
