use super::*;

fn sort_of(view: &str, tree: Option<Expr<EmailLiteral>>) -> String {
    let mut ast = excluded_deferred_partitions();
    ast.document_filter = Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))));
    ast.project_filter = Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))));
    ast.chat_filter = Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))));
    ast.email_filter.tree = tree.map(Arc::new);
    let LocalCompileOutcome::Supported(query) = mail::compile(
        &ast,
        request(),
        view,
        &[Uuid::from_u128(1)],
        "macro|viewer@example.com",
    )
    .unwrap() else {
        panic!("{view} {:?} compiles", ast.email_filter.tree)
    };
    query.as_query().sort_attribute.as_str().to_owned()
}

fn important(value: bool) -> Expr<EmailLiteral> {
    Expr::val(EmailLiteral::Importance(value))
}

fn excluding_shared() -> Expr<EmailLiteral> {
    Expr::val(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Exclude,
    ))
}

#[test]
fn inbox_tab_requiring_importance_walks_the_important_view_key() {
    // The Important tab's filter, in either operand order, and alone.
    for tree in [
        Expr::and(important(true), excluding_shared()),
        Expr::and(excluding_shared(), important(true)),
        important(true),
    ] {
        assert_eq!(sort_of("INBOX", Some(tree)), mail::IMPORTANT_VIEW_SORT);
    }
}

#[test]
fn inbox_tab_that_can_match_unimportant_threads_keeps_the_inbox_view_key() {
    for tree in [
        None,
        Some(Expr::and(important(false), excluding_shared())),
        Some(Expr::or(
            important(true),
            Expr::val(EmailLiteral::Read(true)),
        )),
        Some(Expr::is_not(important(true))),
    ] {
        assert_eq!(sort_of("INBOX", tree), mail::INBOX_VIEW_SORT);
    }
}

#[test]
fn other_views_requiring_importance_keep_their_timestamp() {
    assert_eq!(sort_of("ALL", Some(important(true))), "mail-all-ts");
    assert_eq!(sort_of("SENT", Some(important(true))), "mail-sent-ts");
}
