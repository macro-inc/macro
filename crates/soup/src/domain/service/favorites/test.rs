use super::*;

fn matches(tree: &Expr<EmailLiteral>, id: Uuid) -> bool {
    match tree {
        Expr::Literal(EmailLiteral::ThreadId(value)) => *value == id,
        Expr::And(a, b) => matches(a, id) && matches(b, id),
        Expr::Or(a, b) => matches(a, id) || matches(b, id),
        Expr::Not(a) => !matches(a, id),
        _ => panic!("expected an ID predicate"),
    }
}

#[test]
fn favorites_intersect_existing_filters_and_do_not_cross_entity_types() {
    let kept = Uuid::from_u128(1);
    let removed = Uuid::from_u128(2);
    let other = Uuid::from_u128(3);
    let mut ast = EntityFilterAst::default();
    ast.favorites_only = Some(true);
    ast.email_filter.tree = Some(Arc::new(Expr::is_not(Expr::val(EmailLiteral::ThreadId(
        removed,
    )))));
    let result = apply(
        ast,
        &[
            EntityType::EmailThread.with_entity_string(kept.to_string()),
            EntityType::EmailThread.with_entity_string(removed.to_string()),
            EntityType::Document.with_entity_string(other.to_string()),
        ],
    );
    let tree = result.email_filter.tree.unwrap();
    assert!(matches(&tree, kept));
    assert!(!matches(&tree, removed));
    assert!(!matches(&tree, other));
    assert_eq!(result.favorites_only, None);
}

#[test]
fn no_favorites_matches_no_emails() {
    let result = apply(EntityFilterAst::default(), &[]);
    assert!(!matches(
        result.email_filter.tree.as_deref().unwrap(),
        Uuid::from_u128(1)
    ));
}

fn matches_initiative(tree: &Expr<InitiativeLiteral>, id: Uuid) -> bool {
    match tree {
        Expr::Literal(InitiativeLiteral::Include) => true,
        Expr::Literal(InitiativeLiteral::Id(value)) => *value == id,
        Expr::And(a, b) => matches_initiative(a, id) && matches_initiative(b, id),
        Expr::Or(a, b) => matches_initiative(a, id) || matches_initiative(b, id),
        Expr::Not(a) => !matches_initiative(a, id),
        _ => panic!("expected an initiative ID or include predicate"),
    }
}

#[test]
fn favorite_initiatives_still_require_explicit_opt_in() {
    let id = Uuid::from_u128(1);
    for initiative_filter in [
        None,
        Some(Arc::new(Expr::is_not(Expr::val(InitiativeLiteral::Id(id))))),
    ] {
        let ast = EntityFilterAst {
            initiative_filter,
            ..Default::default()
        };
        let result = apply(
            ast,
            &[EntityType::Initiative.with_entity_string(id.to_string())],
        );
        assert!(!initiatives_requested(result.initiative_filter.as_deref()));
    }
}

#[test]
fn requested_initiatives_intersect_favorites_and_existing_filters() {
    let kept = Uuid::from_u128(1);
    let excluded = Uuid::from_u128(2);
    let other = Uuid::from_u128(3);
    let ast = EntityFilterAst {
        initiative_filter: Some(Arc::new(Expr::and(
            Expr::val(InitiativeLiteral::Include),
            Expr::is_not(Expr::val(InitiativeLiteral::Id(excluded))),
        ))),
        ..Default::default()
    };
    let result = apply(
        ast.clone(),
        &[
            EntityType::Initiative.with_entity_string(kept.to_string()),
            EntityType::Initiative.with_entity_string(excluded.to_string()),
            EntityType::Document.with_entity_string(other.to_string()),
        ],
    );
    let tree = result.initiative_filter.as_deref().unwrap();
    assert!(matches_initiative(tree, kept));
    assert!(!matches_initiative(tree, excluded));
    assert!(!matches_initiative(tree, other));
    let empty = apply(ast, &[]);
    assert!(!matches_initiative(
        empty.initiative_filter.as_deref().unwrap(),
        kept
    ));
}

#[test]
fn id_list_services_intersect_instead_of_widening() {
    let a = Uuid::from_u128(1);
    let b = Uuid::from_u128(2);
    let mut requested = vec![a, b];
    assert!(intersect(&mut requested, vec![b]));
    assert_eq!(requested, vec![b]);
    assert!(!intersect(&mut requested, vec![a]));
    let mut all = vec![];
    assert!(intersect(&mut all, vec![a]));
    assert_eq!(all, vec![a]);
}
