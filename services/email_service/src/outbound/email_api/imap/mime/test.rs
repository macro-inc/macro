use super::*;

#[test]
fn mime_does_not_import_attached_message_text_or_unsanitized_html_and_part_paths_match_downloads() {
    let raw=b"From: Sender <sender@example.com>\r\nTo: receiver@example.com\r\nSubject: Outer\r\nMessage-ID: <outer@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\nContent-Type: text/html\r\n\r\n<p>Hello</p><script>bad()</script>\r\n--outer\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=data.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nAQID\r\n--outer\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment; filename=original.eml\r\n\r\nFrom: inner@example.com\r\nContent-Type: text/plain\r\n\r\nAttached message must not become outer text\r\n--outer--\r\n";
    let source = models::Message {
        id: "m:1".into(),
        thread_id: "t:1".into(),
        folder_id: "inbox".into(),
        flags: vec!["\\Seen".into()],
        tags: Vec::new(),
        version: "v1".into(),
        mime_base64: String::new(),
        size: u32::try_from(raw.len()).unwrap(),
        source_complete: true,
        received_at: Utc::now(),
        is_sent: false,
        draft_correlation: None,
        classification: None,
    };
    let message = parse(Uuid::from_u128(1), &source, raw).unwrap();
    assert_eq!(message.message.subject.as_deref(), Some("Outer"));
    assert!(message.message.body_text.is_none());
    assert!(
        !message
            .message
            .body_html_sanitized
            .unwrap()
            .contains("<script")
    );
    assert_eq!(
        message.message.attachments[0].provider_id.as_deref(),
        Some("2")
    );
    assert_eq!(message.message.attachments[0].size_bytes, Some(3));
    assert_eq!(
        message.message.attachments[1].provider_id.as_deref(),
        Some("3")
    );
}

#[test]
fn deeply_nested_mime_is_rejected_before_recursive_descent_can_overflow() {
    let mut raw = String::from("From: sender@example.com\r\nMIME-Version: 1.0\r\n");
    for index in 0..120 {
        raw.push_str(&format!(
            "Content-Type: multipart/mixed; boundary=level{index}\r\n\r\n--level{index}\r\n"
        ));
    }
    raw.push_str("Content-Type: text/plain\r\n\r\nbody\r\n");
    for index in (0..120).rev() {
        raw.push_str(&format!("--level{index}--\r\n"));
    }
    let source = models::Message {
        id: "m:nested".into(),
        thread_id: "t:nested".into(),
        folder_id: "inbox".into(),
        flags: Vec::new(),
        tags: Vec::new(),
        version: "v1".into(),
        mime_base64: String::new(),
        source_complete: true,
        size: u32::try_from(raw.len()).unwrap(),
        received_at: Utc::now(),
        is_sent: false,
        draft_correlation: None,
        classification: None,
    };
    assert!(matches!(
        parse(Uuid::from_u128(1), &source, raw.as_bytes()),
        Err(EmailApiError::Permanent { .. })
    ));
}

#[test]
fn bounce_displays_delivery_failure_and_keeps_returned_mail_only_as_attachment() {
    let raw=b"From: Mailer-Daemon <postmaster@example.net>\r\nTo: owner@example.com\r\nSubject: Delivery failed\r\nMIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=report\r\n\r\n--report\r\nContent-Type: text/plain\r\n\r\nAddress not found: the message was not delivered.\r\n--report\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; example.net\r\n\r\nFinal-Recipient: rfc822; gone@example.net\r\nAction: failed\r\nStatus: 5.1.1\r\n--report\r\nContent-Type: message/rfc822\r\n\r\nFrom: owner@example.com\r\nTo: gone@example.net\r\nSubject: Original\r\nContent-Type: text/plain\r\n\r\nreturned secret content\r\n--report--\r\n";
    let source = models::Message {
        id: "m:bounce".into(),
        thread_id: "t:bounce".into(),
        folder_id: "inbox".into(),
        flags: Vec::new(),
        tags: Vec::new(),
        version: "v1".into(),
        mime_base64: String::new(),
        source_complete: true,
        size: u32::try_from(raw.len()).unwrap(),
        received_at: Utc::now(),
        is_sent: false,
        draft_correlation: None,
        classification: None,
    };
    let message = parse(Uuid::from_u128(1), &source, raw).unwrap().message;
    assert!(
        message
            .body_text
            .as_ref()
            .unwrap()
            .contains("was not delivered")
    );
    assert!(
        !serde_json::to_string(&message)
            .unwrap()
            .contains("returned secret content")
    );
    assert_eq!(message.attachments.len(), 1);
    assert_eq!(message.attachments[0].provider_id.as_deref(), Some("3"));
}
