use super::*;
fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}
#[test]
fn includes_owner_and_all_delegated_primaries() {
    let owner = id("macro|owner@example.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@example.com".to_string(),
            "macro|primary-b@example.com".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([
            owner,
            id("macro|primary-a@example.com"),
            id("macro|primary-b@example.com"),
        ])
    );
}

#[test]
fn returns_only_owner_when_no_primaries() {
    let owner = id("macro|owner@example.com");
    let recipients = build_notification_recipients(&owner, vec![]);

    assert_eq!(recipients, HashSet::from([owner]));
}

#[test]
fn skips_unparseable_primaries_keeping_valid_ones() {
    let owner = id("macro|owner@example.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@example.com".to_string(),
            "not-a-valid-id".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([owner, id("macro|primary-a@example.com")])
    );
}

#[test]
fn staff_recipients_are_split_onto_the_apns_path() {
    let (staff, customers) = partition_email_push_recipients(HashSet::from([
        id("macro|staff@macro.com"),
        id("macro|staff+notify@macro.com"),
        id("macro|user@example.com"),
    ]));

    assert_eq!(
        staff,
        HashSet::from([
            id("macro|staff@macro.com"),
            id("macro|staff+notify@macro.com"),
        ])
    );
    assert_eq!(customers, HashSet::from([id("macro|user@example.com")]));
}

#[test]
fn customer_only_recipients_do_not_take_the_apns_path() {
    let (staff, customers) =
        partition_email_push_recipients(HashSet::from([id("macro|user@example.com")]));

    assert!(staff.is_empty());
    assert_eq!(customers, HashSet::from([id("macro|user@example.com")]));
}

#[test]
fn signal_filter_requires_importance_and_unshared() {
    let thread_id = Uuid::nil();
    match signal_filter(thread_id) {
        Expr::And(thread, rest) => {
            assert!(matches!(
                *thread,
                Expr::Literal(EmailLiteral::ThreadId(id)) if id == thread_id
            ));
            match *rest {
                Expr::And(importance, shared) => {
                    assert!(matches!(
                        *importance,
                        Expr::Literal(EmailLiteral::Importance(true))
                    ));
                    assert!(matches!(
                        *shared,
                        Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude))
                    ));
                }
                other => panic!("expected importance AND shared, got {other:?}"),
            }
        }
        other => panic!("expected thread AND signal predicates, got {other:?}"),
    }
}
