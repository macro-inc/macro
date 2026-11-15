use model_entity::EntityType;

use super::*;

#[test]
fn a_dedup_key_is_a_short_lowercase_slug_naming_no_one() {
    let mut problems = Vec::new();
    assert_eq!(
        dedup_key(" thread:abc-1/reply ", &mut problems).as_deref(),
        Some("thread:abc-1/reply")
    );
    assert!(problems.is_empty());
    assert_eq!(dedup_key("Reply To Sam", &mut problems), None);
    assert_eq!(
        dedup_key(&"a".repeat(MAX_DEDUP_KEY_CHARS + 1), &mut problems),
        None
    );
    let address = format!("reply:{}@{}.com", "sam", "example");
    assert_eq!(dedup_key(&address, &mut problems), None);
    assert_eq!(problems.len(), 3);
}

#[test]
fn a_prompt_may_span_lines_but_stays_plain() {
    let mut problems = Vec::new();
    assert!(prompt("Read the thread.\nDraft a reply.", &mut problems).is_some());
    assert!(prompt("Read\u{202E} the thread", &mut problems).is_none());
    assert!(prompt("Read\u{0007} the thread", &mut problems).is_none());
    assert!(prompt(&"a".repeat(MAX_PROMPT_CHARS + 1), &mut problems).is_none());
    assert_eq!(problems.len(), 3);
}

#[test]
fn targets_are_bounded_and_named_by_id() {
    let target = |id: &str| Target {
        entity_type: EntityType::Document,
        entity_id: id.to_owned(),
        part_id: None,
    };
    let mut problems = Vec::new();
    assert_eq!(
        targets(vec![target("a"), target("a"), target("b")], &mut problems),
        Some(vec![target("a"), target("b")])
    );
    assert!(targets(vec![target("a b\n")], &mut problems).is_none());
    assert!(
        targets(
            (0..6).map(|n| target(&n.to_string())).collect(),
            &mut problems
        )
        .is_none()
    );
    assert_eq!(problems.len(), 2);
}

#[test]
fn a_new_suggestions_kind_has_its_own_fields_only() {
    let request = |kind: KindName| NewSuggestion {
        kind,
        dedup_key: "k".to_owned(),
        title: "t".to_owned(),
        summary: "s".to_owned(),
        importance: 1,
        categories: Vec::new(),
        about: Vec::new(),
        prompt: None,
        run_mode: None,
        sends: None,
        action: None,
        reason: None,
    };
    let mut problems = Vec::new();
    assert_eq!(new_kind(&request(KindName::Routine), &mut problems), None);
    assert_eq!(new_kind(&request(KindName::Prompt), &mut problems), None);
    let mut entity = request(KindName::Entity);
    entity.prompt = Some("p".to_owned());
    entity.action = Some(super::super::model::EntityAction::Review);
    assert!(new_kind(&entity, &mut problems).is_some());
    // Routine: refused. Prompt: no prompt, no run mode. Entity: a prompt, no items.
    assert_eq!(problems.len(), 5, "{problems:?}");
}
