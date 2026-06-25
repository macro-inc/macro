use super::testing_harness::with_mock_override_env;
use super::*;
use macro_env::Environment;

crate::queue! {
    #[derive(Debug, Clone)]
    pub struct TestQueue {
        local: "test-queue",
        dev: "test-queue-dev",
        prod: "test-queue-prod",
    }
}

fn missing_override(_: &'static str) -> Result<String, std::env::VarError> {
    Err(std::env::VarError::NotPresent)
}

#[test]
fn defaults_are_selected_by_environment() {
    with_mock_override_env(missing_override, || {
        assert_eq!(
            TestQueue::new_for_environment(Environment::Local).as_ref(),
            "test-queue",
        );
        assert_eq!(
            TestQueue::new_for_environment(Environment::Develop).as_ref(),
            "test-queue-dev",
        );
        assert_eq!(
            TestQueue::new_for_environment(Environment::Production).as_ref(),
            "test-queue-prod",
        );
    });
}

#[test]
fn default_values_are_borrowed() {
    let queue = TestQueue::default_for_environment(Environment::Local);

    assert_eq!(queue.as_ref(), "test-queue");
    assert_eq!(queue.inner().borrowed_inner(), Some("test-queue"));
}

fn mock_test_queue_override(var_name: &'static str) -> Result<String, std::env::VarError> {
    (var_name == "OVERRIDE_TEST_QUEUE")
        .then(|| "override-queue".to_string())
        .ok_or(std::env::VarError::NotPresent)
}

#[test]
fn override_env_var_wins_over_environment_default() {
    let queue = with_mock_override_env(mock_test_queue_override, || {
        TestQueue::new_for_environment(Environment::Local)
    });

    assert_eq!(queue.as_ref(), "override-queue");
    assert_eq!(queue.override_env_var_name(), "OVERRIDE_TEST_QUEUE");
    assert_eq!(queue.inner().owned_inner().unwrap(), "override-queue");
}

#[test]
fn helpers_construct_expected_defaults() {
    assert_eq!(TestQueue::local().as_ref(), "test-queue");
    assert_eq!(TestQueue::dev().as_ref(), "test-queue-dev");
    assert_eq!(TestQueue::prod().as_ref(), "test-queue-prod");
}

#[test]
fn copied_returns_a_borrowed_view() {
    let queue = TestQueue::from_owned("runtime-queue");
    let copied = queue.copied();

    assert_eq!(copied.as_ref(), "runtime-queue");
    assert_eq!(copied.borrowed_inner(), Some("runtime-queue"));
}

crate::queue! {
    #[derive(Debug)]
    pub struct TestQueues {
        #[derive(Debug, Clone)]
        pub TestNotificationQueue {
            local: "test-notification-queue",
            dev: "test-notification-queue-dev",
            prod: "test-notification-queue-prod",
        },
        #[derive(Debug, Clone)]
        pub TestSearchEventQueue {
            local: "test-search-event-queue",
            dev: "test-search-event-queue-dev",
            prod: "test-search-event-queue-prod",
        },
    }
}

fn mock_group_overrides(var_name: &'static str) -> Result<String, std::env::VarError> {
    match var_name {
        "OVERRIDE_TEST_SEARCH_EVENT_QUEUE" => Ok("override-search-queue".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn grouped_macro_resolves_all_queues() {
    let queues = with_mock_override_env(mock_group_overrides, || {
        TestQueues::new_for_environment(Environment::Develop)
    });

    assert_eq!(
        queues.test_notification_queue.as_ref(),
        "test-notification-queue-dev",
    );
    assert_eq!(
        queues.test_search_event_queue.as_ref(),
        "override-search-queue",
    );
}

#[test]
fn grouped_defaults_do_not_check_overrides() {
    let queues = TestQueues::default_for_environment(Environment::Production);

    assert_eq!(
        queues.test_notification_queue.as_ref(),
        "test-notification-queue-prod",
    );
    assert_eq!(
        queues.test_search_event_queue.as_ref(),
        "test-search-event-queue-prod",
    );
}

#[test]
fn exported_queues_match_local_values() {
    let queues = Queues::default_for_environment(Environment::Local);

    assert_eq!(
        queues.document_text_extractor_queue.as_ref(),
        "document-text-extractor-lambda-queue",
    );
    assert_eq!(
        queues.chat_delete_queue.as_ref(),
        "delete-chat-handler-queue"
    );
    assert_eq!(
        queues.email_scheduled_queue.as_ref(),
        "email-service-scheduled-queue",
    );
    assert_eq!(
        queues.gmail_ops_queue.as_ref(),
        "email-service-gmail-ops-queue",
    );
    assert_eq!(
        queues.gmail_ops_retry_queue.as_ref(),
        "email-service-gmail-ops-retry-queue",
    );
    assert_eq!(queues.notification_queue.as_ref(), "notification-queue");
    assert_eq!(
        queues.notification_ingress_queue.as_ref(),
        "notification-ingress-queue",
    );
    assert_eq!(queues.search_event_queue.as_ref(), "search-event-queue");
    assert_eq!(queues.ai_projection_queue.as_ref(), "ai-projection-queue");
    assert_eq!(queues.convert_queue.as_ref(), "convert-service-queue");
    assert_eq!(
        queues.document_delete_queue.as_ref(),
        "delete-document-handler-queue",
    );
    assert_eq!(queues.sfs_delete_queue.as_ref(), "email-sfs-delete-queue");
    assert_eq!(
        queues.sfs_uploader_queue.as_ref(),
        "email-service-sfs-mapper-queue",
    );
    assert_eq!(queues.contacts_queue.as_ref(), "contacts-queue");
    assert_eq!(
        queues.push_notification_event_handler_queue.as_ref(),
        "push-delivery-queue",
    );
    assert_eq!(
        queues.static_file_service_s3_event_queue_url.as_ref(),
        "static-file-s3-event-notification-queue",
    );
    assert_eq!(
        queues.link_manager_queue.as_ref(),
        "email-service-refresh-queue",
    );
    assert_eq!(
        queues.gmail_inbox_sync_queue.as_ref(),
        "email-service-gmail-inbox-sync-queue",
    );
    assert_eq!(
        queues.gmail_inbox_sync_retry_queue.as_ref(),
        "email-service-gmail-inbox-retry-queue",
    );
    assert_eq!(
        queues.email_backfill_queue.as_ref(),
        "email-service-backfill-queue",
    );
    assert_eq!(queues.upload_extractor_queue.as_ref(), "bulk-upload-queue");
    assert_eq!(
        queues.organization_retention_queue.as_ref(),
        "organization-retention-handler-queue",
    );
}

#[test]
fn exported_queues_match_dev_values() {
    let queues = Queues::default_for_environment(Environment::Develop);

    assert_eq!(
        queues.document_text_extractor_queue.as_ref(),
        "document-text-extractor-lambda-queue-dev",
    );
    assert_eq!(
        queues.chat_delete_queue.as_ref(),
        "delete-chat-handler-queue-dev",
    );
    assert_eq!(
        queues.email_scheduled_queue.as_ref(),
        "email-service-scheduled-queue-dev",
    );
    assert_eq!(
        queues.gmail_ops_queue.as_ref(),
        "email-service-gmail-ops-queue-dev",
    );
    assert_eq!(
        queues.gmail_ops_retry_queue.as_ref(),
        "email-service-gmail-ops-retry-queue-dev",
    );
    assert_eq!(queues.notification_queue.as_ref(), "notification-queue-dev");
    assert_eq!(
        queues.notification_ingress_queue.as_ref(),
        "notification-ingress-queue-dev",
    );
    assert_eq!(queues.search_event_queue.as_ref(), "search-event-queue-dev");
    assert_eq!(
        queues.ai_projection_queue.as_ref(),
        "ai-projection-queue-dev",
    );
    assert_eq!(queues.convert_queue.as_ref(), "convert-service-queue-dev");
    assert_eq!(
        queues.document_delete_queue.as_ref(),
        "delete-document-handler-queue-dev",
    );
    assert_eq!(
        queues.sfs_delete_queue.as_ref(),
        "email-sfs-delete-queue-dev",
    );
    assert_eq!(
        queues.sfs_uploader_queue.as_ref(),
        "email-service-sfs-mapper-queue-dev",
    );
    assert_eq!(queues.contacts_queue.as_ref(), "contacts-queue-dev");
    assert_eq!(
        queues.push_notification_event_handler_queue.as_ref(),
        "push-delivery-queue-dev",
    );
    assert_eq!(
        queues.static_file_service_s3_event_queue_url.as_ref(),
        "static-file-s3-event-notification-queue-dev",
    );
    assert_eq!(
        queues.link_manager_queue.as_ref(),
        "email-service-refresh-queue-dev",
    );
    assert_eq!(
        queues.gmail_inbox_sync_queue.as_ref(),
        "email-service-gmail-webhook-queue-dev",
    );
    assert_eq!(
        queues.gmail_inbox_sync_retry_queue.as_ref(),
        "email-service-gmail-webhook-retry-queue-dev",
    );
    assert_eq!(
        queues.email_backfill_queue.as_ref(),
        "email-service-backfill-queue-dev",
    );
    assert_eq!(
        queues.upload_extractor_queue.as_ref(),
        "bulk-upload-queue-dev",
    );
    assert_eq!(
        queues.organization_retention_queue.as_ref(),
        "organization-retention-handler-queue-dev",
    );
}

#[test]
fn exported_queues_match_prod_values() {
    let queues = Queues::default_for_environment(Environment::Production);

    assert_eq!(
        queues.document_text_extractor_queue.as_ref(),
        "document-text-extractor-lambda-queue-prod",
    );
    assert_eq!(
        queues.chat_delete_queue.as_ref(),
        "delete-chat-handler-queue-prod",
    );
    assert_eq!(
        queues.email_scheduled_queue.as_ref(),
        "email-service-scheduled-queue-prod",
    );
    assert_eq!(
        queues.gmail_ops_queue.as_ref(),
        "email-service-gmail-ops-queue-prod",
    );
    assert_eq!(
        queues.gmail_ops_retry_queue.as_ref(),
        "email-service-gmail-ops-retry-queue-prod",
    );
    assert_eq!(
        queues.notification_queue.as_ref(),
        "notification-queue-prod"
    );
    assert_eq!(
        queues.notification_ingress_queue.as_ref(),
        "notification-ingress-queue-prod",
    );
    assert_eq!(
        queues.search_event_queue.as_ref(),
        "search-event-queue-prod"
    );
    assert_eq!(
        queues.ai_projection_queue.as_ref(),
        "ai-projection-queue-prod",
    );
    assert_eq!(queues.convert_queue.as_ref(), "convert-service-queue-prod");
    assert_eq!(
        queues.document_delete_queue.as_ref(),
        "delete-document-handler-queue-prod",
    );
    assert_eq!(
        queues.sfs_delete_queue.as_ref(),
        "email-sfs-delete-queue-prod",
    );
    assert_eq!(
        queues.sfs_uploader_queue.as_ref(),
        "email-service-sfs-mapper-queue-prod",
    );
    assert_eq!(queues.contacts_queue.as_ref(), "contacts-queue-prod");
    assert_eq!(
        queues.push_notification_event_handler_queue.as_ref(),
        "push-delivery-queue-prod",
    );
    assert_eq!(
        queues.static_file_service_s3_event_queue_url.as_ref(),
        "static-file-s3-event-notification-queue-prod",
    );
    assert_eq!(
        queues.link_manager_queue.as_ref(),
        "email-service-refresh-queue-prod",
    );
    assert_eq!(
        queues.gmail_inbox_sync_queue.as_ref(),
        "email-service-gmail-webhook-queue-prod",
    );
    assert_eq!(
        queues.gmail_inbox_sync_retry_queue.as_ref(),
        "email-service-gmail-webhook-retry-queue-prod",
    );
    assert_eq!(
        queues.email_backfill_queue.as_ref(),
        "email-service-backfill-queue-prod",
    );
    assert_eq!(
        queues.upload_extractor_queue.as_ref(),
        "bulk-upload-queue-prod",
    );
    assert_eq!(
        queues.organization_retention_queue.as_ref(),
        "organization-retention-handler-queue-prod",
    );
}

#[test]
fn exported_queue_override_names_are_derived_from_env_var_names() {
    assert_eq!(
        DocumentTextExtractorQueue::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_TEXT_EXTRACTOR_QUEUE",
    );
    assert_eq!(
        ChatDeleteQueue::local().override_env_var_name(),
        "OVERRIDE_CHAT_DELETE_QUEUE",
    );
    assert_eq!(
        EmailScheduledQueue::local().override_env_var_name(),
        "OVERRIDE_EMAIL_SCHEDULED_QUEUE",
    );
    assert_eq!(
        GmailOpsQueue::local().override_env_var_name(),
        "OVERRIDE_GMAIL_OPS_QUEUE",
    );
    assert_eq!(
        GmailOpsRetryQueue::local().override_env_var_name(),
        "OVERRIDE_GMAIL_OPS_RETRY_QUEUE",
    );
    assert_eq!(
        NotificationQueue::local().override_env_var_name(),
        "OVERRIDE_NOTIFICATION_QUEUE",
    );
    assert_eq!(
        NotificationIngressQueue::local().override_env_var_name(),
        "OVERRIDE_NOTIFICATION_INGRESS_QUEUE",
    );
    assert_eq!(
        SearchEventQueue::local().override_env_var_name(),
        "OVERRIDE_SEARCH_EVENT_QUEUE",
    );
    assert_eq!(
        AiProjectionQueue::local().override_env_var_name(),
        "OVERRIDE_AI_PROJECTION_QUEUE",
    );
    assert_eq!(
        ConvertQueue::local().override_env_var_name(),
        "OVERRIDE_CONVERT_QUEUE",
    );
    assert_eq!(
        DocumentDeleteQueue::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_DELETE_QUEUE",
    );
    assert_eq!(
        SfsDeleteQueue::local().override_env_var_name(),
        "OVERRIDE_SFS_DELETE_QUEUE",
    );
    assert_eq!(
        SfsUploaderQueue::local().override_env_var_name(),
        "OVERRIDE_SFS_UPLOADER_QUEUE",
    );
    assert_eq!(
        ContactsQueue::local().override_env_var_name(),
        "OVERRIDE_CONTACTS_QUEUE",
    );
    assert_eq!(
        PushNotificationEventHandlerQueue::local().override_env_var_name(),
        "OVERRIDE_PUSH_NOTIFICATION_EVENT_HANDLER_QUEUE",
    );
    // Pins the digit-boundary case: `S3` stays fused with a separator after it.
    assert_eq!(
        StaticFileServiceS3EventQueueUrl::local().override_env_var_name(),
        "OVERRIDE_STATIC_FILE_SERVICE_S3_EVENT_QUEUE_URL",
    );
    assert_eq!(
        LinkManagerQueue::local().override_env_var_name(),
        "OVERRIDE_LINK_MANAGER_QUEUE",
    );
    assert_eq!(
        GmailInboxSyncQueue::local().override_env_var_name(),
        "OVERRIDE_GMAIL_INBOX_SYNC_QUEUE",
    );
    assert_eq!(
        GmailInboxSyncRetryQueue::local().override_env_var_name(),
        "OVERRIDE_GMAIL_INBOX_SYNC_RETRY_QUEUE",
    );
    assert_eq!(
        EmailBackfillQueue::local().override_env_var_name(),
        "OVERRIDE_EMAIL_BACKFILL_QUEUE",
    );
    assert_eq!(
        UploadExtractorQueue::local().override_env_var_name(),
        "OVERRIDE_UPLOAD_EXTRACTOR_QUEUE",
    );
    assert_eq!(
        OrganizationRetentionQueue::local().override_env_var_name(),
        "OVERRIDE_ORGANIZATION_RETENTION_QUEUE",
    );
}

#[test]
fn queue_deserializes_from_string() {
    use serde::Deserialize;
    use serde::de::IntoDeserializer;
    use serde::de::value::{Error as DeError, StrDeserializer};

    let deserializer: StrDeserializer<DeError> = "custom-queue".into_deserializer();
    let queue = EmailScheduledQueue::deserialize(deserializer).unwrap();

    assert_eq!(queue.as_str(), "custom-queue");
}

#[test]
fn queue_converts_to_string() {
    let queue = Queue::borrowed("borrowed-queue");
    let queue_string: String = queue.into();

    assert_eq!(queue_string, "borrowed-queue");
}
