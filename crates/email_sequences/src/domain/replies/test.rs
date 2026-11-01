use super::*;
use chrono::TimeZone;

fn headers(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

#[test]
fn classifier_table() {
    let cases = [
        (
            "plain reply",
            vec![],
            Some("ada@example.com"),
            Response::Reply,
        ),
        (
            "delivery report",
            vec![(
                "Content-Type",
                "multipart/report; report-type=\"delivery-status\"; boundary=x",
            )],
            Some("postmaster@remote.example"),
            Response::Bounce,
        ),
        (
            "Gmail delay notice: still retrying",
            vec![
                (
                    "Content-Type",
                    "multipart/report; report-type=delivery-status",
                ),
                ("Subject", "Delivery Status Notification (Delay)"),
            ],
            Some("mailer-daemon@googlemail.com"),
            Response::AutoReply,
        ),
        (
            "Postfix delay notice",
            vec![("Subject", "Delayed Mail (still being retried)")],
            Some("MAILER-DAEMON@mx.example.org"),
            Response::AutoReply,
        ),
        (
            "a failed recipient wins over a delay subject",
            vec![
                ("X-Failed-Recipients", "ada@example.com"),
                ("Subject", "Delivery Status Notification (Delay)"),
            ],
            Some("mailer-daemon@googlemail.com"),
            Response::Bounce,
        ),
        (
            "delivery report from anyone",
            vec![(
                "content-type",
                "multipart/report; report-type=delivery-status",
            )],
            Some("ops@remote.example"),
            Response::Bounce,
        ),
        (
            "Gmail bounce",
            vec![
                ("X-Failed-Recipients", "ada@example.com"),
                ("Auto-Submitted", "auto-replied"),
            ],
            Some("mailer-daemon@googlemail.com"),
            Response::Bounce,
        ),
        (
            "daemon sender alone",
            vec![],
            Some("MAILER-DAEMON@x.example"),
            Response::Bounce,
        ),
        (
            "out of office",
            vec![("Auto-Submitted", "auto-replied")],
            Some("ada@example.com"),
            Response::AutoReply,
        ),
        (
            "Auto-Submitted: no is a person",
            vec![("Auto-Submitted", "No (comment)")],
            Some("ada@example.com"),
            Response::Reply,
        ),
        (
            "Auto-Submitted with a comment",
            vec![("auto-submitted", "auto-replied (vacation)")],
            Some("ada@example.com"),
            Response::AutoReply,
        ),
        (
            "X-Autoreply",
            vec![("X-Autoreply", "yes")],
            Some("ada@example.com"),
            Response::AutoReply,
        ),
        (
            "X-Autorespond",
            vec![("x-autorespond", "")],
            Some("ada@example.com"),
            Response::AutoReply,
        ),
        (
            "Precedence: auto_reply",
            vec![("Precedence", "auto_reply")],
            Some("ada@example.com"),
            Response::AutoReply,
        ),
        (
            "Precedence: bulk is still a person",
            vec![("Precedence", "bulk")],
            Some("ada@example.com"),
            Response::Reply,
        ),
        (
            "X-Auto-Response-Suppress is still a person",
            vec![("X-Auto-Response-Suppress", "All")],
            Some("ada@example.com"),
            Response::Reply,
        ),
    ];
    for (name, pairs, from, expected) in cases {
        assert_eq!(classify(&headers(&pairs), from), expected, "{name}");
    }
}

#[test]
fn reference_and_failure_headers_parse() {
    let parsed = headers(&[
        ("In-Reply-To", "<b@x>"),
        ("References", "<a@x>\r\n <b@x>"),
        ("X-Failed-Recipients", "Ada@Example.com, bob@example.com"),
    ]);
    assert_eq!(references(&parsed), ["a@x", "b@x"]);
    assert_eq!(
        failed_recipients(&parsed),
        ["ada@example.com", "bob@example.com"]
    );
}

#[test]
fn each_rule_matches_on_its_own() {
    let sent = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
    let step_message = Uuid::from_u128(1);
    let steps = [SentIdentity {
        message_id: step_message,
        delivery_message_id: Some("step@send.macro.com".to_owned()),
        provider_message_id: Some("step@mail.gmail.com".to_owned()),
    }];
    let enrolled = Enrolled {
        email: "ada@example.com",
        replies_after: Some(sent),
        steps: &steps,
    };
    let later = Some(sent + chrono::Duration::minutes(5));
    let from_colleague = Incoming {
        received_at: later,
        from: Some("colleague@example.com".to_owned()),
        ..Incoming::default()
    };
    let cases = [
        (
            "1: In-Reply-To names the delivery Message-ID",
            Incoming {
                references: vec!["step@send.macro.com".to_owned()],
                ..from_colleague.clone()
            },
            Some(Response::Reply),
        ),
        (
            "1: References resolve to the step message",
            Incoming {
                referenced_message_ids: vec![step_message],
                ..from_colleague.clone()
            },
            Some(Response::Reply),
        ),
        (
            "2: replying_to_id is the step message",
            Incoming {
                replying_to_id: Some(step_message),
                ..from_colleague.clone()
            },
            Some(Response::Reply),
        ),
        (
            "3: from the enrolled address, new thread, no In-Reply-To",
            Incoming {
                from: Some("ada@example.com".to_owned()),
                ..from_colleague.clone()
            },
            Some(Response::Reply),
        ),
        (
            "4: a bounce naming the enrolled address",
            Incoming {
                from: Some("mailer-daemon@googlemail.com".to_owned()),
                failed_recipients: vec!["ada@example.com".to_owned()],
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            Some(Response::Bounce),
        ),
        (
            "4b: a remote bounce that names the address only in its text",
            Incoming {
                from: Some("mailer-daemon@remote.example".to_owned()),
                bounce_text: Some("<ada@example.com>: host said: 550 no such user".to_owned()),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            Some(Response::Bounce),
        ),
        (
            "a bounce naming a longer address",
            Incoming {
                from: Some("mailer-daemon@remote.example".to_owned()),
                bounce_text: Some("<grada@example.com.au> failed".to_owned()),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "a bounce naming the address in a longer domain",
            Incoming {
                from: Some("mailer-daemon@remote.example".to_owned()),
                bounce_text: Some("delivery to ada@example.com.au failed".to_owned()),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "a bounce naming the address at the end of a sentence",
            Incoming {
                from: Some("postmaster@remote.example".to_owned()),
                bounce_text: Some(
                    "your message couldn't be delivered to ada@example.com.".to_owned(),
                ),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            Some(Response::Bounce),
        ),
        (
            "a bounce for someone else that quotes the contact in its headers",
            Incoming {
                from: Some("postmaster@contoso.com".to_owned()),
                bounce_text: Some(
                    "your message to bob@contoso.com couldn't be delivered.\n\
                     original message headers:\n\
                     to: bob@contoso.com\n\
                     cc: ada <ada@example.com>"
                        .to_owned(),
                ),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "a bounce whose quoted address headers fold onto the contact",
            Incoming {
                from: Some("mailer-daemon@remote.example".to_owned()),
                bounce_text: Some(
                    "<bob@contoso.com>: 550 no such user\n\
                     to: bob <bob@contoso.com>,\n \
                     ada <ada@example.com>"
                        .to_owned(),
                ),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "a qmail bounce that copies the original below its failure",
            Incoming {
                from: Some("mailer-daemon@remote.example".to_owned()),
                bounce_text: Some(
                    "<bob@contoso.com>:\nsorry, no mailbox here by that name.\n\
                     --- below this line is a copy of the message.\n\
                     hi bob, looping in ada@example.com"
                        .to_owned(),
                ),
                response: Response::Bounce,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "1: Message-IDs compare without regard to case",
            Incoming {
                references: vec!["STEP@send.macro.com".to_owned()],
                ..from_colleague.clone()
            },
            Some(Response::Reply),
        ),
        ("unrelated mail", from_colleague.clone(), None),
        (
            "an out-of-office from the contact",
            Incoming {
                from: Some("ada@example.com".to_owned()),
                response: Response::AutoReply,
                ..from_colleague.clone()
            },
            None,
        ),
        (
            "mail from the contact before the first send",
            Incoming {
                received_at: Some(sent - chrono::Duration::minutes(5)),
                from: Some("ada@example.com".to_owned()),
                ..from_colleague.clone()
            },
            None,
        ),
    ];
    for (name, incoming, expected) in cases {
        assert_eq!(stop_reason(&enrolled, &incoming), expected, "{name}");
    }

    // Before anything is recorded sent, only the step's own ids count: the
    // in-flight step's claim-time Message-ID resolves to its message.
    let unsent = Enrolled {
        replies_after: None,
        ..enrolled.clone()
    };
    let resolved = Incoming {
        referenced_message_ids: vec![step_message],
        ..from_colleague.clone()
    };
    assert_eq!(stop_reason(&unsent, &resolved), Some(Response::Reply));
    let from_contact = Incoming {
        from: Some("ada@example.com".to_owned()),
        ..from_colleague
    };
    assert_eq!(stop_reason(&unsent, &from_contact), None);
}
