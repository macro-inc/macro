use super::*;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::gmail::inbox_sync::{
    DeleteMessagePayload, GmailMessagePayload, UpdateLabelsPayload, UpsertMessagePayload,
};
use models_email::service::link::UserProvider;
use uuid::Uuid;

fn link(is_sync_active: bool, needs_reauth: bool) -> Link {
    Link {
        id: Uuid::from_u128(1),
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        fusionauth_user_id: "fusionauth-user".to_string(),
        email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active,
        is_primary: true,
        needs_reauth,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn gmail_notification() -> InboxSyncOperation {
    InboxSyncOperation::GmailMessage(GmailMessagePayload { history_id: 42 })
}

fn fanned_out_operations() -> Vec<InboxSyncOperation> {
    let provider_message_id = "provider-message".to_string();
    vec![
        InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
            provider_message_id: provider_message_id.clone(),
        }),
        InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
            provider_message_id: provider_message_id.clone(),
        }),
        InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
            provider_message_id,
        }),
    ]
}

#[test]
fn processes_gmail_notification_for_healthy_link() {
    assert!(should_process(&link(true, false), &gmail_notification()));
}

#[test]
fn skips_gmail_notification_for_link_that_needs_reauth() {
    assert!(!should_process(&link(true, true), &gmail_notification()));
}

#[test]
fn processes_fanned_out_operations_for_link_that_needs_reauth() {
    for operation in fanned_out_operations() {
        assert!(should_process(&link(true, true), &operation), "{operation}");
    }
}

#[test]
fn skips_every_operation_when_sync_is_disabled() {
    for needs_reauth in [false, true] {
        let link = link(false, needs_reauth);
        assert!(!should_process(&link, &gmail_notification()));
        for operation in fanned_out_operations() {
            assert!(!should_process(&link, &operation), "{operation}");
        }
    }
}
