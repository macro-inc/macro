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

#[test]
fn descriptions_say_when_to_use_the_skill() {
    for skill in SYSTEM_SKILLS {
        assert!(
            skill.description.starts_with("Use when "),
            "{}: {}",
            skill.slug,
            skill.description
        );
        assert!(
            skill.description.chars().count() <= MAX_DESCRIPTION_CHARS,
            "{} description is too long",
            skill.slug
        );
    }
}

#[test]
fn listed_skills_exclude_agent_only_skills() {
    let listed: Vec<&str> = listed().map(|skill| skill.slug).collect();
    for skill in SYSTEM_SKILLS {
        assert_eq!(
            listed.contains(&skill.slug),
            skill.visibility == Visibility::Listed,
            "{}",
            skill.slug
        );
    }
}

#[test]
fn catalog_names_every_skill_with_its_id_and_description() {
    let catalog = catalog();
    assert!(catalog.starts_with("# Built-in skills\n"));
    for skill in SYSTEM_SKILLS {
        assert!(
            catalog.contains(&format!(
                "- {} ({}): {}\n",
                skill.name,
                skill.id(),
                skill.description
            )),
            "{} missing from the catalog",
            skill.slug
        );
    }
}

#[test]
fn inline_skills_are_the_agent_only_bodies_in_order() {
    let expected: String = SYSTEM_SKILLS
        .iter()
        .filter(|skill| skill.visibility == Visibility::AgentOnly)
        .map(|skill| skill.render_content())
        .collect();
    assert_eq!(inline(), expected);
}
