use super::*;

#[test]
fn independent_dsn_recipients_and_original_message() {
    let message=b"Content-Type: multipart/report; report-type=delivery-status; boundary=boundary\r\n\r\n--boundary\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mx.example\r\n\r\nFinal-Recipient: rfc822; a@example.com\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\nFinal-Recipient: rfc822; b@example.com\r\nAction: delayed\r\nStatus: 4.2.2\r\n\r\n--boundary\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <original@example.com>\r\n\r\n--boundary--";
    let result = classify(message);
    assert_eq!(result.delivery.len(), 2);
    assert_eq!(result.delivery[1].action, DeliveryAction::Delayed);
    assert_eq!(
        result.original_message_id.as_deref(),
        Some("<original@example.com>")
    );
}
#[test]
fn arf_report_and_auto_reply_remain_separate() {
    let report=b"Content-Type: multipart/report; report-type=feedback-report; boundary=a\r\n\r\n--a\r\nContent-Type: message/feedback-report\r\n\r\nFeedback-Type: abuse\r\nOriginal-Rcpt-To: rfc822; complaint@example.com\r\nSource-IP: 192.0.2.1\r\n\r\n--a--";
    let result = classify(report);
    assert!(result.delivery.is_empty());
    assert_eq!(
        result.complaint.unwrap().recipients,
        ["complaint@example.com"]
    );
    assert!(classify(b"Subject: Out of the Office\r\n\r\nhello").auto_reply);
    assert!(!classify(b"Subject: Auto: shipment\r\nAuto-Submitted: no\r\n\r\nhello").auto_reply);
}

#[test]
fn distinguish_delayed_delivery_from_final_failure_quoting_temporary_response() {
    for (explanation, expected) in [
        ("We will keep trying.", DeliveryAction::Delayed),
        ("I am not going to try again.", DeliveryAction::Failed),
    ] {
        let message = format!(
            "From: Mailer-Daemon <postmaster@example.net>\r\nSubject: Delivery report\r\n\r\n<reader@example.com>: host mx.example.com said: 451 4.4.1 unavailable\r\n\r\n{explanation}"
        );
        let classification = classify(message.as_bytes());
        assert_eq!(classification.delivery[0].action, expected);
        assert_eq!(classification.delivery[0].status.as_deref(), Some("4.4.1"));
    }
}
