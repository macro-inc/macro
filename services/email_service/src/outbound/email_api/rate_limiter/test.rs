use email_api_client::domain::models::ApiOperationKind;
use models_email::gmail::operations::GmailApiOperation;
use uuid::Uuid;

use super::{RateBudget, gmail_operation, rate_limit_args, rate_limit_result};

#[test]
fn every_api_operation_maps_to_the_expected_quota_operation() {
    let mappings = [
        (
            ApiOperationKind::GetProfile,
            GmailApiOperation::UsersGetProfile,
        ),
        (
            ApiOperationKind::ListChanges,
            GmailApiOperation::HistoryList,
        ),
        (ApiOperationKind::ListLabels, GmailApiOperation::LabelsList),
        (
            ApiOperationKind::CreateLabel,
            GmailApiOperation::LabelsCreate,
        ),
        (
            ApiOperationKind::DeleteLabel,
            GmailApiOperation::LabelsDelete,
        ),
        (ApiOperationKind::GetMessage, GmailApiOperation::MessagesGet),
        (
            ApiOperationKind::ListMessages,
            GmailApiOperation::MessagesList,
        ),
        (
            ApiOperationKind::ModifyMessageLabels,
            GmailApiOperation::MessagesModify,
        ),
        (
            ApiOperationKind::GetAttachment,
            GmailApiOperation::MessagesAttachmentsGet,
        ),
        (
            ApiOperationKind::SendMessage,
            GmailApiOperation::MessagesSend,
        ),
        (ApiOperationKind::GetThread, GmailApiOperation::ThreadsGet),
        (
            ApiOperationKind::ListThreads,
            GmailApiOperation::ThreadsList,
        ),
        (
            ApiOperationKind::ListContacts,
            GmailApiOperation::UsersGetProfile,
        ),
        (
            ApiOperationKind::BlockSender,
            GmailApiOperation::SettingsFiltersCreate,
        ),
        (
            ApiOperationKind::UnblockSender,
            GmailApiOperation::SettingsFiltersDelete,
        ),
        (
            ApiOperationKind::ListBlockedSenders,
            GmailApiOperation::SettingsFiltersList,
        ),
        (ApiOperationKind::Subscribe, GmailApiOperation::Watch),
        (ApiOperationKind::Unsubscribe, GmailApiOperation::Stop),
    ];

    for (operation, expected) in mappings {
        assert_eq!(
            gmail_operation(operation),
            expected,
            "mapping for {operation:?}"
        );
    }
}

#[test]
fn contacts_use_a_one_unit_shared_budget_proxy() {
    assert_eq!(gmail_operation(ApiOperationKind::ListContacts).cost(), 1);
}

#[test]
fn composite_blocklist_operations_use_the_dominant_filter_write_cost() {
    assert_eq!(gmail_operation(ApiOperationKind::BlockSender).cost(), 5);
    assert_eq!(gmail_operation(ApiOperationKind::UnblockSender).cost(), 5);
}

#[test]
fn refusal_is_returned_only_for_a_denied_preflight_check() {
    assert!(rate_limit_result(false).is_ok());

    let refusal = rate_limit_result(true).expect_err("denied request should be refused");
    assert_eq!(refusal.retry_after, None);
}

#[test]
fn rate_budget_selects_live_or_backfill_limit() {
    let link_id = Uuid::new_v4();

    let live = rate_limit_args(link_id, ApiOperationKind::GetMessage, RateBudget::Live);
    assert_eq!(live.user_id, link_id);
    assert_eq!(live.operation, GmailApiOperation::MessagesGet);
    assert!(!live.is_backfill);

    let backfill = rate_limit_args(link_id, ApiOperationKind::GetMessage, RateBudget::Backfill);
    assert_eq!(backfill.user_id, link_id);
    assert_eq!(backfill.operation, GmailApiOperation::MessagesGet);
    assert!(backfill.is_backfill);
}
