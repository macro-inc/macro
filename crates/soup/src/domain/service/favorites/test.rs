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
