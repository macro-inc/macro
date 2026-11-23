use std::sync::{Arc, Mutex};

use super::*;
use crate::domain::models::{BouncedRecipient, ComplainedRecipient};

type Calls = Arc<Mutex<Vec<Vec<String>>>>;

struct Store {
    calls: Calls,
    fail: bool,
}

impl SuppressionStore for Store {
    async fn bulk_upsert_block_email(&self, emails: &[&str]) -> anyhow::Result<()> {
        self.calls
            .lock()
            .unwrap()
            .push(emails.iter().map(|email| (*email).to_owned()).collect());
        if self.fail {
            anyhow::bail!("synthetic storage failure");
        }
        Ok(())
    }
}

fn service(fail: bool) -> (NotificationSuppression<Store>, Calls) {
    let calls = Calls::default();
    (
        NotificationSuppression::new(Store {
            calls: Arc::clone(&calls),
            fail,
        }),
        calls,
    )
}

fn bounce(kind: BounceType, subtype: BounceSubType, emails: &[&str]) -> BounceNotification {
    BounceNotification {
        bounce_type: kind,
        bounce_sub_type: subtype,
        bounced_recipients: emails
            .iter()
            .map(|email| BouncedRecipient {
                email_address: (*email).to_owned(),
                action: None,
                status: None,
                diagnostic_code: None,
            })
            .collect(),
        timestamp: "2025-01-01T00:00:00Z".into(),
        feedback_id: "synthetic-feedback".into(),
        remote_mta_ip: None,
        reporting_mta: None,
    }
}

fn complaint(
    feedback: Option<ComplaintFeedbackType>,
    subtype: Option<&str>,
    emails: &[&str],
) -> ComplaintNotification {
    ComplaintNotification {
        complained_recipients: emails
            .iter()
            .map(|email| ComplainedRecipient {
                email_address: (*email).to_owned(),
            })
            .collect(),
        timestamp: "2025-01-01T00:00:00Z".into(),
        feedback_id: "synthetic-feedback".into(),
        complaint_sub_type: subtype.map(str::to_owned),
        user_agent: None,
        complaint_feedback_type: feedback,
        arrival_date: None,
    }
}

#[tokio::test]
async fn permanent_bounce_preserves_raw_recipient_order_and_duplicates() {
    let (service, calls) = service(false);
    let emails = [
        "First@EXAMPLE.com",
        "",
        "NOT AN ADDRESS",
        "First@EXAMPLE.com",
    ];
    service
        .handle_bounce_notification(&bounce(
            BounceType::Permanent,
            BounceSubType::General,
            &emails,
        ))
        .await
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), [emails.map(str::to_owned).to_vec()]);
}

#[tokio::test]
async fn every_permanent_bounce_subtype_suppresses() {
    let (service, calls) = service(false);
    for subtype in [
        BounceSubType::Undetermined,
        BounceSubType::General,
        BounceSubType::NoEmail,
        BounceSubType::Suppressed,
        BounceSubType::OnAccountSuppressionList,
        BounceSubType::MailboxFull,
        BounceSubType::MessageTooLarge,
        BounceSubType::ContentRejected,
        BounceSubType::AttachmentRejected,
    ] {
        service
            .handle_bounce_notification(&bounce(
                BounceType::Permanent,
                subtype,
                &["recipient@example.com"],
            ))
            .await
            .unwrap();
    }
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec!["recipient@example.com".to_owned()]; 9]
    );
}

#[tokio::test]
async fn nonpanicking_transient_subtypes_do_not_suppress() {
    let (service, calls) = service(false);
    for subtype in [
        BounceSubType::General,
        BounceSubType::MailboxFull,
        BounceSubType::MessageTooLarge,
        BounceSubType::ContentRejected,
        BounceSubType::AttachmentRejected,
    ] {
        service
            .handle_bounce_notification(&bounce(
                BounceType::Transient,
                subtype,
                &["recipient@example.com"],
            ))
            .await
            .unwrap();
    }
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn undetermined_bounces_do_not_suppress_for_any_subtype() {
    let (service, calls) = service(false);
    for subtype in [
        BounceSubType::Undetermined,
        BounceSubType::General,
        BounceSubType::NoEmail,
        BounceSubType::Suppressed,
        BounceSubType::OnAccountSuppressionList,
        BounceSubType::MailboxFull,
        BounceSubType::MessageTooLarge,
        BounceSubType::ContentRejected,
        BounceSubType::AttachmentRejected,
    ] {
        service
            .handle_bounce_notification(&bounce(
                BounceType::Undetermined,
                subtype,
                &["recipient@example.com"],
            ))
            .await
            .unwrap();
    }
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn any_present_complaint_subtype_takes_precedence_over_every_feedback() {
    let (service, calls) = service(false);
    for subtype in ["", "OnAccountSuppressionList"] {
        for feedback in [
            None,
            Some(ComplaintFeedbackType::Abuse),
            Some(ComplaintFeedbackType::AuthFailure),
            Some(ComplaintFeedbackType::Fraud),
            Some(ComplaintFeedbackType::Virus),
            Some(ComplaintFeedbackType::Other),
            Some(ComplaintFeedbackType::NotSpam),
        ] {
            service
                .handle_complaint_notification(&complaint(
                    feedback,
                    Some(subtype),
                    &["recipient@example.com"],
                ))
                .await
                .unwrap();
        }
    }
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec!["recipient@example.com".to_owned()]; 14]
    );
}

#[tokio::test]
async fn blocking_complaint_feedback_suppresses_without_a_subtype() {
    let (service, calls) = service(false);
    for feedback in [
        ComplaintFeedbackType::Abuse,
        ComplaintFeedbackType::AuthFailure,
        ComplaintFeedbackType::Fraud,
        ComplaintFeedbackType::Virus,
        ComplaintFeedbackType::Other,
    ] {
        service
            .handle_complaint_notification(&complaint(
                Some(feedback),
                None,
                &["recipient@example.com"],
            ))
            .await
            .unwrap();
    }
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec!["recipient@example.com".to_owned()]; 5]
    );
}

#[tokio::test]
async fn absent_or_not_spam_feedback_without_a_subtype_does_not_suppress() {
    let (service, calls) = service(false);
    for feedback in [None, Some(ComplaintFeedbackType::NotSpam)] {
        service
            .handle_complaint_notification(&complaint(feedback, None, &["recipient@example.com"]))
            .await
            .unwrap();
    }
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn empty_recipients_still_call_the_store_on_each_suppression_path() {
    let (service, calls) = service(false);
    service
        .handle_bounce_notification(&bounce(BounceType::Permanent, BounceSubType::General, &[]))
        .await
        .unwrap();
    service
        .handle_complaint_notification(&complaint(None, Some(""), &[]))
        .await
        .unwrap();
    service
        .handle_complaint_notification(&complaint(Some(ComplaintFeedbackType::Abuse), None, &[]))
        .await
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![Vec::<String>::new(); 3]);
}

#[tokio::test]
async fn each_suppression_path_preserves_the_store_error_context() {
    let (service, calls) = service(true);
    let results = [
        service
            .handle_bounce_notification(&bounce(
                BounceType::Permanent,
                BounceSubType::General,
                &["recipient@example.com"],
            ))
            .await,
        service
            .handle_complaint_notification(&complaint(None, Some(""), &["recipient@example.com"]))
            .await,
        service
            .handle_complaint_notification(&complaint(
                Some(ComplaintFeedbackType::Abuse),
                None,
                &["recipient@example.com"],
            ))
            .await,
    ];
    for result in results {
        let error = result.unwrap_err();
        assert_eq!(error.to_string(), "failed to upsert block email");
        assert_eq!(
            format!("{error:#}"),
            "failed to upsert block email: synthetic storage failure"
        );
    }
    assert_eq!(calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn repeated_notifications_call_the_store_again() {
    let (service, calls) = service(false);
    let notification = bounce(
        BounceType::Permanent,
        BounceSubType::General,
        &["recipient@example.com"],
    );
    service
        .handle_bounce_notification(&notification)
        .await
        .unwrap();
    service
        .handle_bounce_notification(&notification)
        .await
        .unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec!["recipient@example.com".to_owned()]; 2]
    );
}
