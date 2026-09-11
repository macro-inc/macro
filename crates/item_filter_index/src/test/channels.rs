use super::*;
use item_filters::{NotificationState, ast::channel::ChannelTypeFilter};
use predicate_index::{ExactFact, IndexDocument, RecordKey};

fn channel(participant: bool, team: Option<u128>, org: Option<i64>) -> IndexDocument {
    let mut facts = vec![
        ExactFact {
            attribute: vocabulary::id(),
            value: ExactValue::new(Uuid::from_u128(1).as_bytes()).unwrap(),
        },
        ExactFact {
            attribute: vocabulary::channel_type(),
            value: ExactValue::utf8("team").unwrap(),
        },
        ExactFact {
            attribute: vocabulary::channel_participant(),
            value: ExactValue::new([u8::from(participant)]).unwrap(),
        },
    ];
    if let Some(team) = team {
        facts.push(ExactFact {
            attribute: vocabulary::channel_team(),
            value: ExactValue::new(Uuid::from_u128(team).as_bytes()).unwrap(),
        });
    }
    if let Some(org) = org {
        facts.push(ExactFact {
            attribute: vocabulary::channel_organization(),
            value: ExactValue::new(org.to_be_bytes()).unwrap(),
        });
    }
    IndexDocument {
        record_key: RecordKey::new("GraphqlSoupChannel:1").unwrap(),
        profile: vocabulary::profile_v4(),
        partition: vocabulary::channel_partition(),
        exact_facts: facts,
        integer_facts: vec![],
        sort_facts: vec![],
    }
}

fn predicate(expr: Option<Expr<ChannelLiteral>>) -> PredicateExpr {
    let mut ast = excluded_deferred_partitions();
    ast.channel_filter = expr.map(Arc::new);
    let LocalCompileOutcome::Supported(query) = compile_soup_flat_v4(&ast, request()).unwrap()
    else {
        panic!("supported channel filter")
    };
    query
        .as_query()
        .partitions
        .iter()
        .find(|p| p.partition == vocabulary::channel_partition())
        .unwrap()
        .predicate
        .clone()
}

#[test]
fn general_soup_supports_channels_without_enabling_legacy_profiles() {
    let mut ast = excluded_deferred_partitions();
    ast.channel_filter = None;
    assert!(matches!(
        compile_soup_flat_v3(&ast, request()).unwrap(),
        LocalCompileOutcome::Unsupported(UnsupportedReason::Partition("channel"))
    ));
    assert!(channel(true, None, None).matches(&predicate(None)));
    assert!(!channel(false, None, None).matches(&predicate(None)));
    let active = predicate(Some(Expr::val(ChannelLiteral::NotificationState(
        NotificationState::Unseen,
    ))));
    let mut doc = channel(true, None, None);
    assert!(!doc.matches(&active));
    doc.exact_facts.push(ExactFact {
        attribute: vocabulary::notification_unseen(),
        value: ExactValue::new(Uuid::from_u128(2).as_bytes()).unwrap(),
    });
    assert!(doc.matches(&active));
}

#[test]
fn channel_nullable_filters_preserve_sql_three_valued_logic() {
    let team = Expr::val(ChannelLiteral::TeamId(Uuid::from_u128(10)));
    let org = Expr::val(ChannelLiteral::OrganizationId(20));
    let cases = [
        (Expr::is_not(team.clone()), [false, false, true]),
        (
            Expr::is_not(Expr::or(team.clone(), org.clone())),
            [false, false, true],
        ),
        (Expr::is_not(Expr::and(team, org)), [false, false, true]),
    ];
    let docs = [
        channel(true, None, None),
        channel(true, Some(10), Some(20)),
        channel(true, Some(11), Some(21)),
    ];
    for (expr, expected) in cases {
        let predicate = predicate(Some(expr));
        for (document, expected) in docs.iter().zip(expected) {
            assert_eq!(document.matches(&predicate), expected);
        }
    }
}

#[test]
fn channel_importance_true_matches_the_servers_omitted_clause() {
    let importance = Expr::val(ChannelLiteral::Importance(true));
    let dm = Expr::val(ChannelLiteral::ChannelType(
        ChannelTypeFilter::DirectMessage,
    ));
    assert!(!channel(true, None, None).matches(&predicate(Some(Expr::or(importance.clone(), dm)))));
    assert!(channel(true, None, None).matches(&predicate(Some(Expr::is_not(importance)))));
    assert!(
        !channel(true, None, None).matches(&predicate(Some(Expr::val(
            ChannelLiteral::Importance(false)
        ))))
    );
}

#[test]
fn deferred_channel_predicates_and_widened_access_stay_network_only() {
    for expr in [
        Expr::val(ChannelLiteral::ThreadId(Uuid::from_u128(1))),
        Expr::val(ChannelLiteral::NotificationState(NotificationState::Done)),
        Expr::val(ChannelLiteral::IsParticipant(false)),
        Expr::is_not(Expr::val(ChannelLiteral::IsParticipant(true))),
        Expr::or(
            Expr::val(ChannelLiteral::IsParticipant(true)),
            Expr::val(ChannelLiteral::ChannelType(ChannelTypeFilter::Team)),
        ),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.channel_filter = Some(Arc::new(expr));
        assert!(matches!(
            compile_soup_flat_v4(&ast, request()).unwrap(),
            LocalCompileOutcome::Unsupported(_)
        ));
    }
    let member = predicate(Some(Expr::and(
        Expr::val(ChannelLiteral::Importance(true)),
        Expr::val(ChannelLiteral::IsParticipant(true)),
    )));
    assert!(channel(true, None, None).matches(&member));
    assert!(!channel(false, None, None).matches(&member));
}
