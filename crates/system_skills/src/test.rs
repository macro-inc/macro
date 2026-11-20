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

/// The Compose Routines skill finds items with the SDK's existing searches
/// and lists, tells the owner through an Ask AI step, and ends with the
/// code-step text CreateRoutine and the drafter read. The code form code mode
/// carries leaves out the routine-tools part, and the routine-tools form
/// leaves out the code-step text, which `CreateRoutine`'s description already
/// carries.
#[test]
fn compose_routines_finds_items_with_the_sdk_and_ends_with_the_code_step_text() {
    let content = compose_routines::SKILL.render_content();
    for rule in [
        "macro.channels.search(name)",
        "searchOn: 'name', matchType: 'exact'",
        "macro.users.search(name)",
        "macro.initiatives.summaries()",
        "macro.routines.check(routine, { created })",
        "a code step never messages or emails the routine's owner",
        "This replaces what the routines guide says about ids in knobs.",
        "# Without code",
    ] {
        assert!(content.contains(rule), "{rule}");
    }
    let code = compose_routines::CODE.to_string();
    assert!(
        content
            .trim_end()
            .ends_with(routine_program::CODE_STEPS.trim_end())
    );
    assert!(
        code.trim_end()
            .ends_with(routine_program::CODE_STEPS.trim_end())
    );
    assert!(code.contains("macro.routines.check(routine, { created })"));
    assert!(!code.contains("# Without code"));
    let direct = compose_routines::DIRECT.to_string();
    assert!(direct.contains("a code step never messages or emails the routine's owner"));
    assert!(!direct.contains(routine_program::CODE_STEPS));
    assert!(direct.contains("`NameSearch`"));
    assert!(!direct.contains("ExecuteCode"));
}

/// The skill's routine looks list Macro's icons and colors, as saving takes
/// them.
#[test]
fn compose_routines_lists_macros_icons_and_colors() {
    let content = compose_routines::SKILL.render_content();
    let listed = |label: &str| -> Vec<String> {
        let line = content
            .lines()
            .find_map(|line| line.trim().strip_prefix(label))
            .unwrap_or_else(|| panic!("no {label} line"));
        line.trim_end_matches('.')
            .replace(" or ", ", ")
            .split(", ")
            .map(str::to_owned)
            .collect()
    };
    assert_eq!(
        listed("- `name`, an icon: "),
        model_entity::macro_icon_names().to_vec()
    );
    let colors = listed("- `color`: ");
    assert_eq!(colors.len(), 12, "{colors:?}");
    for color in colors {
        serde_json::from_value::<model_entity::AppearanceColor>(serde_json::json!(color))
            .unwrap_or_else(|error| panic!("{color}: {error}"));
    }
}
