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

#[test]
fn combined_add_and_remove_diff_requires_one_metadata_update() {
    let labels_to_add = vec![service::label::system_labels::INBOX.to_string()];
    let labels_to_delete = vec![service::label::system_labels::TRASH.to_string()];

    assert!(label_diff_requires_metadata_update(
        &labels_to_add,
        &labels_to_delete
    ));
}

#[test]
fn add_only_diff_can_require_metadata_update() {
    let labels_to_add = vec![service::label::system_labels::UNREAD.to_string()];

    assert!(label_diff_requires_metadata_update(&labels_to_add, &[]));
}

#[test]
fn remove_only_diff_can_require_metadata_update() {
    let labels_to_delete = vec![service::label::system_labels::SENT.to_string()];

    assert!(label_diff_requires_metadata_update(&[], &labels_to_delete));
}

#[test]
fn empty_diff_does_not_require_metadata_update() {
    assert!(!label_diff_requires_metadata_update(&[], &[]));
}

#[test]
fn all_thread_metadata_and_signal_labels_are_relevant() {
    let relevant_labels = [
        service::label::system_labels::INBOX,
        service::label::system_labels::SENT,
        service::label::system_labels::DRAFT,
        service::label::system_labels::SPAM,
        service::label::system_labels::TRASH,
        service::label::system_labels::UNREAD,
        "CATEGORY_PERSONAL",
        "CATEGORY_SOCIAL",
        "CATEGORY_PROMOTIONS",
        "CATEGORY_UPDATES",
        "CATEGORY_FORUMS",
    ];

    for label in relevant_labels {
        assert!(
            is_thread_metadata_label(label),
            "{label} should be relevant"
        );
    }
}

#[test]
fn user_and_unrelated_system_labels_are_irrelevant() {
    for label in [
        "Label_123",
        service::label::system_labels::STARRED,
        service::label::system_labels::IMPORTANT,
    ] {
        assert!(
            !is_thread_metadata_label(label),
            "{label} should be irrelevant"
        );
    }

    let labels_to_add = vec!["Label_123".to_string()];
    let labels_to_delete = vec![service::label::system_labels::STARRED.to_string()];
    assert!(!label_diff_requires_metadata_update(
        &labels_to_add,
        &labels_to_delete
    ));
}
