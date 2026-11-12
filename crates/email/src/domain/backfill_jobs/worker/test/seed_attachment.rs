use super::*;
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts, RateLimitOrigin};
use models_email::service::address::ContactInfo;

#[tokio::test]
async fn contact_seed_provider_absence_and_failure_do_not_enqueue() {
    let (svc, f) = setup();
    assert!(matches!(
        svc.process(&seed()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["job", "link", "provider"]);
    let (svc, f) = setup();
    f.0.lock().unwrap().provider = Err(EmailApiError::Forbidden);
    failure(
        svc.process(&seed()).await,
        false,
        FailureReason::GmailApiFailed,
    );
    assert_eq!(f.calls(), ["job", "link", "provider"]);
    let (svc, f) = setup();
    f.0.lock().unwrap().provider = Err(EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(23)),
        origin: RateLimitOrigin::Local,
    });
    let BackfillDisposition::Defer { retry_after, error } = svc.process(&seed()).await else {
        panic!("deferral")
    };
    assert_eq!(retry_after, Some(Duration::from_secs(23)));
    assert_eq!(error.reason, FailureReason::GmailApiRateLimited);
}

#[tokio::test]
async fn each_seed_filter_preserves_valid_neighbors_and_original_recipient_order() {
    for skipped in [
        "",
        "owner@example.com",
        "noreply@example.com",
        "not-an-address",
    ] {
        let (svc, f) = setup();
        let mut message = provider_message(LINK, Uuid::from_u128(40));
        message.to = vec![
            ContactInfo {
                email: " FIRST@example.com ".into(),
                name: None,
                photo_url: None,
            },
            ContactInfo {
                email: skipped.into(),
                name: None,
                photo_url: None,
            },
        ];
        message.cc = vec![
            ContactInfo {
                email: "first@example.com".into(),
                name: None,
                photo_url: None,
            },
            ContactInfo {
                email: "second@example.com".into(),
                name: None,
                photo_url: None,
            },
        ];
        message.bcc = vec![ContactInfo {
            email: "third@example.com".into(),
            name: None,
            photo_url: None,
        }];
        f.0.lock().unwrap().provider = Ok(Some(MessageWithCalendarParts {
            message,
            calendar_parts: vec![],
        }));
        assert!(matches!(
            svc.process(&seed()).await,
            BackfillDisposition::DoneDelete
        ));
        let state = f.0.lock().unwrap();
        assert_eq!(state.connections.len(), 3);
        for (connection, recipient) in state.connections.iter().zip([
            "first@example.com",
            "second@example.com",
            "third@example.com",
        ]) {
            assert_eq!(
                *connection,
                std::collections::HashSet::from([
                    link().macro_id,
                    macro_user_id::user_id::MacroUserIdStr::try_from_email(recipient).unwrap()
                ])
            );
        }
    }
}

#[tokio::test]
async fn a_seed_enqueue_failure_is_terminal_and_stops_later_recipients() {
    let (svc, f) = setup();
    let mut message = provider_message(LINK, Uuid::from_u128(40));
    message.to = vec![
        ContactInfo {
            email: "first@example.com".into(),
            name: None,
            photo_url: None,
        },
        ContactInfo {
            email: "second@example.com".into(),
            name: None,
            photo_url: None,
        },
    ];
    f.0.lock().unwrap().provider = Ok(Some(MessageWithCalendarParts {
        message,
        calendar_parts: vec![],
    }));
    f.fail("connect");
    let e = failure(
        svc.process(&seed()).await,
        false,
        FailureReason::SqsEnqueueFailed,
    );
    assert_eq!(
        e.source.to_string(),
        "Failed to enqueue contact connection for sent-message seed"
    );
    assert_eq!(f.calls(), ["job", "link", "provider", "connect"]);
}

#[tokio::test]
async fn attachments_run_after_completion_but_not_failure_or_cancellation() {
    for status in [
        BackfillJobStatus::Complete,
        BackfillJobStatus::Failed,
        BackfillJobStatus::Cancelled,
    ] {
        let (svc, f) = setup();
        f.0.lock().unwrap().job.as_mut().unwrap().status = status;
        assert!(matches!(
            svc.process(&attachment()).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(
            f.calls(),
            if status == BackfillJobStatus::Complete {
                vec!["job", "link", "document", "upload"]
            } else {
                vec!["job", "delete_job_progress"]
            }
        );
    }
}

#[tokio::test]
async fn existing_attachment_document_skips_upload_and_query_failure_is_terminal() {
    let (svc, f) = setup();
    f.0.lock().unwrap().document = true;
    assert!(matches!(
        svc.process(&attachment()).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["job", "link", "document"]);
    let (svc, f) = setup();
    f.fail("document");
    failure(
        svc.process(&attachment()).await,
        false,
        FailureReason::DatabaseQueryFailed,
    );
    assert_eq!(f.calls(), ["job", "link", "document"]);
}

#[tokio::test]
async fn deleted_refused_and_failed_uploads_keep_distinct_outcomes_and_errors() {
    let (svc, f) = setup();
    f.0.lock().unwrap().upload = Some(BackfillUploadError::Deleted);
    assert!(matches!(
        svc.process(&attachment()).await,
        BackfillDisposition::DoneDelete
    ));
    let (svc, f) = setup();
    f.0.lock().unwrap().upload = Some(BackfillUploadError::RateLimited(
        EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(8)),
            origin: RateLimitOrigin::Local,
        },
    ));
    let BackfillDisposition::Defer { error, retry_after } = svc.process(&attachment()).await else {
        panic!("deferral")
    };
    assert_eq!(error.reason, FailureReason::GmailApiRateLimited);
    assert_eq!(retry_after, Some(Duration::from_secs(8)));
    let (svc, f) = setup();
    f.0.lock().unwrap().upload = Some(BackfillUploadError::Failed(anyhow::anyhow!(
        "original upload error"
    )));
    let e = failure(
        svc.process(&attachment()).await,
        false,
        FailureReason::GmailApiFailed,
    );
    assert_eq!(
        format!("{:#}", e.source),
        "Failed to upload attachment: original upload error"
    );
}
