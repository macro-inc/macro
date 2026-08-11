use super::*;

fn extract(expr: &Expr<ReminderLiteral>) -> Option<ReminderFilterExtract> {
    let mut out = ReminderFilterExtract::default();
    extract_reminder_filter(expr, &mut out).then_some(out)
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

#[test]
fn include_literal_opts_in_on_its_own() {
    let out = extract(&Expr::val(ReminderLiteral::Include)).expect("supported shape");

    assert!(out.opted_in());
    assert!(out.ids.is_empty());
    assert!(out.entities.is_empty());
}

#[test]
fn completed_alone_does_not_opt_in() {
    // The filter is meaningful but names no reminders, so Soup must still skip
    // the leg rather than return every reminder the user has.
    let out = extract(&Expr::val(ReminderLiteral::Completed(false))).expect("supported shape");

    assert!(!out.opted_in());
    assert_eq!(out.completed, Some(false));
}

#[test]
fn include_and_completed_narrows_to_uncompleted() {
    let expr = Expr::and(
        Expr::val(ReminderLiteral::Include),
        Expr::val(ReminderLiteral::Completed(false)),
    );

    let out = extract(&expr).expect("supported shape");

    assert!(out.opted_in());
    assert_eq!(out.completed, Some(false));
}

#[test]
fn ids_or_ids_flattens() {
    let expr = Expr::or(
        Expr::val(ReminderLiteral::Id(id(1))),
        Expr::val(ReminderLiteral::Id(id(2))),
    );

    let out = extract(&expr).expect("an ids-only Or flattens faithfully");

    assert_eq!(out.ids, vec![id(1), id(2)]);
}

// The repo ANDs `ids` against `entities`, so flattening `Id OR Entity` would
// silently return their intersection — narrower than asked.
#[test]
fn or_mixing_ids_and_entities_is_rejected() {
    let expr = Expr::or(
        Expr::val(ReminderLiteral::Id(id(1))),
        Expr::val(ReminderLiteral::Entity("document:abc".to_string())),
    );

    assert!(extract(&expr).is_none());
}

#[test]
fn and_mixing_ids_and_entities_is_kept() {
    // An `And` is exactly what the repo does, so this one flattens correctly.
    let expr = Expr::and(
        Expr::val(ReminderLiteral::Id(id(1))),
        Expr::val(ReminderLiteral::Entity("document:abc".to_string())),
    );

    let out = extract(&expr).expect("supported shape");

    assert_eq!(out.ids, vec![id(1)]);
    assert_eq!(out.entities, vec!["document:abc".to_string()]);
}

#[test]
fn ids_only_or_beside_an_entity_and_is_kept() {
    // The `Or` itself contributes only ids; the entity comes from the `And`,
    // so the AND-flattening still matches the requested semantics.
    let expr = Expr::and(
        Expr::or(
            Expr::val(ReminderLiteral::Id(id(1))),
            Expr::val(ReminderLiteral::Id(id(2))),
        ),
        Expr::val(ReminderLiteral::Entity("document:abc".to_string())),
    );

    let out = extract(&expr).expect("supported shape");

    assert_eq!(out.ids, vec![id(1), id(2)]);
    assert_eq!(out.entities, vec!["document:abc".to_string()]);
}

#[test]
fn conflicting_completed_literals_fail_closed() {
    let expr = Expr::and(
        Expr::val(ReminderLiteral::Completed(true)),
        Expr::val(ReminderLiteral::Completed(false)),
    );

    assert!(extract(&expr).is_none());
}

#[test]
fn negation_fails_closed() {
    assert!(extract(&Expr::is_not(Expr::val(ReminderLiteral::Include))).is_none());
}
