use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap()
}

#[test]
fn builds_provider_origin_spam_addition() {
    let link_id = Uuid::from_u128(1);
    let thread_id = Uuid::from_u128(2);
    let owner = owner();
    let labels_to_add = vec![service::label::system_labels::SPAM.to_string()];

    let metadata =
        build_provider_spam_changed_metadata(link_id, &owner, thread_id, &labels_to_add, &[]);

    assert_eq!(
        metadata,
        Some(ThreadSpamChangedMetadata {
            link_id,
            owner,
            actor: None,
            thread_id,
            spam: true,
            origin: EmailEventOrigin::ProviderSync,
        })
    );
}

#[test]
fn builds_provider_origin_spam_removal() {
    let link_id = Uuid::from_u128(1);
    let thread_id = Uuid::from_u128(2);
    let owner = owner();
    let labels_to_delete = vec![service::label::system_labels::SPAM.to_string()];

    let metadata =
        build_provider_spam_changed_metadata(link_id, &owner, thread_id, &[], &labels_to_delete);

    assert_eq!(
        metadata,
        Some(ThreadSpamChangedMetadata {
            link_id,
            owner,
            actor: None,
            thread_id,
            spam: false,
            origin: EmailEventOrigin::ProviderSync,
        })
    );
}

#[test]
fn ignores_diffs_without_spam_changes() {
    let labels_to_add = vec![service::label::system_labels::STARRED.to_string()];

    assert_eq!(
        build_provider_spam_changed_metadata(
            Uuid::from_u128(1),
            &owner(),
            Uuid::from_u128(2),
            &labels_to_add,
            &[],
        ),
        None
    );
}

#[test]
fn spam_remains_excluded_from_user_label_events() {
    assert!(!is_user_label(service::label::system_labels::SPAM));
}
