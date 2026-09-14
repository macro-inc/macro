use super::*;

#[test]
fn frontend_nil_exclusions_are_supported_without_indexing_deferred_entities() {
    let mut ast = excluded_deferred_partitions();
    ast.channel_thread_filter = Some(Arc::new(Expr::val(ChannelThreadLiteral::ChannelId(
        Uuid::nil(),
    ))));
    ast.reminder_filter = Some(Arc::new(Expr::val(ReminderLiteral::Id(Uuid::nil()))));
    ast.agent_session_filter = Some(Arc::new(Expr::val(AgentSessionLiteral::Id(Uuid::nil()))));
    assert_eq!(check_soup_flat_v3(&ast, request()), Eligibility::Supported);
    assert!(matches!(
        compile_soup_flat_v4(&ast, request()).unwrap(),
        LocalCompileOutcome::Supported(_)
    ));

    // Exact forms emitted by the Email view's confine()/GraphQL translation.
    ast.document_filter = Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil()))));
    ast.project_filter = Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))));
    ast.chat_filter = Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))));
    ast.email_filter.tree = Some(Arc::new(Expr::and(
        Expr::val(EmailLiteral::Importance(false)),
        Expr::val(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Exclude,
        )),
    )));
    assert!(matches!(
        mail::compile(
            &ast,
            request(),
            "INBOX",
            &[Uuid::from_u128(1)],
            "macro|viewer@example.com"
        )
        .unwrap(),
        LocalCompileOutcome::Supported(_)
    ));
}

#[test]
fn opt_in_partitions_still_reject_trees_that_could_match() {
    for tree in [
        Expr::val(ReminderLiteral::Include),
        Expr::val(ReminderLiteral::Id(Uuid::from_u128(1))),
        Expr::is_not(Expr::val(ReminderLiteral::Id(Uuid::nil()))),
        Expr::or(
            Expr::val(ReminderLiteral::Id(Uuid::nil())),
            Expr::val(ReminderLiteral::Include),
        ),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.reminder_filter = Some(Arc::new(tree));
        assert_eq!(
            check_soup_flat_v3(&ast, request()),
            Eligibility::Unsupported(UnsupportedReason::Partition("reminder"))
        );
    }
    for tree in [
        Expr::val(AgentSessionLiteral::Include),
        Expr::val(AgentSessionLiteral::Id(Uuid::from_u128(1))),
        Expr::is_not(Expr::val(AgentSessionLiteral::Id(Uuid::nil()))),
        Expr::or(
            Expr::val(AgentSessionLiteral::Id(Uuid::nil())),
            Expr::val(AgentSessionLiteral::Include),
        ),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.agent_session_filter = Some(Arc::new(tree));
        assert_eq!(
            check_soup_flat_v3(&ast, request()),
            Eligibility::Unsupported(UnsupportedReason::Partition("agent_session"))
        );
    }
    for tree in [
        Expr::val(ChannelThreadLiteral::ChannelId(Uuid::from_u128(1))),
        Expr::is_not(Expr::val(ChannelThreadLiteral::ChannelId(Uuid::nil()))),
        Expr::or(
            Expr::val(ChannelThreadLiteral::ChannelId(Uuid::nil())),
            Expr::val(ChannelThreadLiteral::ThreadId(Uuid::from_u128(1))),
        ),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.channel_thread_filter = Some(Arc::new(tree));
        assert_eq!(
            check_soup_flat_v3(&ast, request()),
            Eligibility::Unsupported(UnsupportedReason::Partition("channelThread"))
        );
    }
}

#[test]
fn conjoined_nil_exclusions_prove_empty_even_with_opt_in_literals() {
    let mut ast = excluded_deferred_partitions();
    ast.reminder_filter = Some(Arc::new(Expr::and(
        Expr::val(ReminderLiteral::Include),
        Expr::val(ReminderLiteral::Id(Uuid::nil())),
    )));
    ast.agent_session_filter = Some(Arc::new(Expr::and(
        Expr::val(AgentSessionLiteral::Id(Uuid::nil())),
        Expr::val(AgentSessionLiteral::Include),
    )));
    assert_eq!(check_soup_flat_v3(&ast, request()), Eligibility::Supported);
}
