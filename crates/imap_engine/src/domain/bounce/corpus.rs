//! Synthetic versions of the received-message shapes from EmailEngine's v2.89.0 corpus.
//! Addresses, message bodies and identifiers are authored fixtures.
use super::*;

fn multipart(kind: &str, outer: &str, parts: &[(&str, &str)]) -> String {
    let mut raw = format!("{outer}\r\nContent-Type: multipart/{kind}; boundary=report\r\n\r\n");
    for (mime, body) in parts {
        raw.push_str(&format!(
            "--report\r\nContent-Type: {mime}\r\n\r\n{body}\r\n"
        ));
    }
    raw.push_str("--report--\r\n");
    raw
}

const ORIGINAL: &str =
    "From: sender@example.net\r\nMessage-ID: <original@example.net>\r\n\r\nA synthetic note.";
const STATUS: &str = "Reporting-MTA: dns; mx.example.net\r\n\r\nFinal-Recipient: rfc822; recipient@example.net\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 5.1.1 mailbox absent\r\n";
const MAILER: &str = "From: Mailer-Daemon <postmaster@example.net>\r\nSubject: Delivery report";

#[test]
fn structured_and_text_dsns_match_each_recipient_and_original_message() {
    let delayed = STATUS
        .replace("Action: failed", "Action: delayed")
        .replace("5.1.1", "4.2.2");
    let workmail = format!("Technical report:\r\n{STATUS}");
    let zoho = " Message-ID: <original@example.net>\r\n\r\nA synthetic note.".to_string();
    let yahoo = "<recipient@example.net>:\r\n  550 5.1.1 user unknown";
    let returned = [
        (
            "163",
            multipart(
                "related",
                MAILER,
                &[
                    ("image/png", "synthetic"),
                    ("message/delivery-status", STATUS),
                    ("message/rfc822", ORIGINAL),
                ],
            ),
        ),
        (
            "delayed",
            multipart(
                "report",
                MAILER,
                &[
                    ("message/delivery-status", &delayed),
                    ("text/rfc822-headers", ORIGINAL),
                ],
            ),
        ),
        (
            "workmail",
            multipart(
                "mixed",
                "X-Mailer: Amazon WorkMail\r\nThread-Topic: Undelivered Mail Returned to Sender",
                &[("text/plain", &workmail), ("message/rfc822", ORIGINAL)],
            ),
        ),
        (
            "zoho",
            multipart(
                "report",
                "From: mailer-daemon@example.net\r\nX-Mailer: Zoho Mail",
                &[("message/delivery-status", STATUS), ("text/rfc822", &zoho)],
            ),
        ),
        (
            "yahoo",
            multipart(
                "report",
                MAILER,
                &[("text/plain", yahoo), ("message/rfc822", ORIGINAL)],
            ),
        ),
        (
            "zonemta",
            multipart(
                "report",
                MAILER,
                &[
                    ("message/delivery-status", STATUS),
                    ("text/rfc822-headers", ORIGINAL),
                ],
            ),
        ),
        // Fastmail, Gmail, Hotmail, Mail.ru, Outlook, Postfix and Rambler all return this MIME shape.
        (
            "standard",
            multipart(
                "report",
                MAILER,
                &[
                    ("text/plain", "Could not deliver your message."),
                    ("message/delivery-status", STATUS),
                    ("message/rfc822", ORIGINAL),
                ],
            ),
        ),
    ];
    for (provider, raw) in returned {
        let result = classify(raw.as_bytes());
        assert_eq!(result.delivery.len(), 1, "{provider}");
        assert_eq!(
            result.delivery[0].recipient, "recipient@example.net",
            "{provider}"
        );
        assert_eq!(
            result.delivery[0].action,
            if provider == "delayed" {
                DeliveryAction::Delayed
            } else {
                DeliveryAction::Failed
            },
            "{provider}"
        );
        assert_eq!(
            result.original_message_id.as_deref(),
            Some("<original@example.net>"),
            "{provider}"
        );
    }
}

#[test]
fn abuse_dmarc_opt_out_and_hotmail_feedback_preserve_type_and_identity() {
    for (provider, kind, original_type) in [
        ("standard", "abuse", "message/rfc822"),
        ("amazon", "abuse", "message/rfc822"),
        ("dmarc", "auth-failure", "message/rfc822"),
        ("optout", "opt-out", "text/rfc822-header"),
        ("yahoo", "abuse", "message/rfc822"),
        ("hotmail", "abuse", "message/rfc822"),
    ] {
        let fields = format!(
            "Feedback-Type: {kind}\r\nOriginal-Rcpt-To: rfc822; reader@example.net\r\nSource-IP: 192.0.2.1\r\n"
        );
        let original = format!("X-HmXmrOriginalRecipient: reader@example.net\r\n{ORIGINAL}");
        let raw = if provider == "hotmail" {
            multipart(
                "mixed",
                &format!("From: staff@{}", "hotmail.com"),
                &[(original_type, &original)],
            )
        } else {
            multipart(
                "report",
                "Subject: Synthetic feedback",
                &[
                    ("message/feedback-report", &fields),
                    (original_type, &original),
                ],
            )
        };
        let c = classify(raw.as_bytes());
        let report = c.complaint.unwrap();
        assert_eq!(report.feedback_type, kind, "{provider}");
        assert_eq!(report.recipients, ["reader@example.net"], "{provider}");
        assert_eq!(
            c.original_message_id.as_deref(),
            Some("<original@example.net>"),
            "{provider}"
        );
    }
}

#[test]
fn automatic_replies_require_a_recognized_header_or_subject() {
    for header in [
        "Auto-Submitted: auto-replied",
        "Subject: Automatic reply: Away",
        "Subject: Auto: Away\r\nIn-Reply-To: <original@example.net>",
        "X-Auto-Response-Suppress: All",
        "Precedence: auto_reply",
        "Subject: Out of Office",
    ] {
        assert!(classify(format!("{header}\r\n\r\nA synthetic reply.").as_bytes()).auto_reply);
    }
    for header in [
        "Auto-Submitted: no",
        "Subject: Auto: Shipment",
        "Subject: Re: Holiday request",
    ] {
        assert!(!classify(format!("{header}\r\n\r\nHello").as_bytes()).auto_reply);
    }
}
