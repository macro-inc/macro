//! Independent SMTP peer checks the bytes and whether delivery was ever attempted.
use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Default)]
struct Transcript {
    commands: Vec<String>,
    delivered: String,
}
async fn exchange(
    extensions: &[&str],
    from: &str,
    recipient: &str,
    wire: &str,
    acknowledge: bool,
) -> (Result<SubmissionOutcome, Error>, Transcript) {
    let (mut client, server) = tokio::io::duplex(65536);
    let mut hello = "250-peer.example.net\r\n".to_owned();
    for extension in extensions {
        hello.push_str(&format!("250-{extension}\r\n"));
    }
    hello.push_str("250 OK\r\n");
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(server);
        let mut transcript = Transcript::default();
        peer.get_mut()
            .write_all(b"220 peer.example.net\r\n")
            .await
            .unwrap();
        loop {
            let mut line = String::new();
            if peer.read_line(&mut line).await.unwrap() == 0 {
                break;
            }
            transcript.commands.push(line.clone());
            if line.starts_with("EHLO ") {
                peer.get_mut().write_all(hello.as_bytes()).await.unwrap();
            } else if line.starts_with("MAIL FROM:") || line.starts_with("RCPT TO:") {
                peer.get_mut().write_all(b"250 accepted\r\n").await.unwrap();
            } else if line == "DATA\r\n" {
                peer.get_mut().write_all(b"354 continue\r\n").await.unwrap();
                loop {
                    let mut data = String::new();
                    assert!(peer.read_line(&mut data).await.unwrap() > 0);
                    if data == ".\r\n" {
                        break;
                    }
                    transcript.delivered.push_str(if data.starts_with("..") {
                        &data[1..]
                    } else {
                        &data
                    });
                }
                if !acknowledge {
                    break;
                }
                peer.get_mut().write_all(b"250 queued\r\n").await.unwrap();
            } else {
                panic!("unexpected SMTP command: {line:?}");
            }
        }
        transcript
    });
    assert_eq!(response(&mut client).await.unwrap().0, 220);
    let extensions = Extensions::parse(&ehlo(&mut client).await.unwrap());
    let outcome = deliver(
        &mut client,
        &extensions,
        from,
        &[recipient.into()],
        wire,
        tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
    )
    .await;
    drop(client);
    let transcript = tokio::time::timeout(Duration::from_secs(3), peer)
        .await
        .unwrap()
        .unwrap();
    (outcome, transcript)
}
fn rejected_before_envelope(outcome: Result<SubmissionOutcome, Error>, transcript: &Transcript) {
    assert!(matches!(
        outcome,
        Ok(SubmissionOutcome::Rejected {
            refusal: SubmissionRefusal {
                phase: SubmissionRefusalPhase::Message,
                recipient_index: None,
                reply_class: None
            }
        })
    ));
    assert_eq!(
        transcript.commands.len(),
        1,
        "no envelope or DATA may be sent"
    );
    assert!(transcript.commands[0].starts_with("EHLO "));
    assert!(transcript.delivered.is_empty());
}
const ASCII: &str =
    "From: owner@example.net\r\nTo: recipient@example.net\r\nSubject: ASCII\r\n\r\nbody\r\n";

#[tokio::test]
async fn refusal_before_data_is_definite_and_any_negative_final_reply_is_unknown() {
    for (phase, refusal, expected) in [
        (
            "mail",
            451,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Sender,
                    recipient_index: None,
                    reply_class: Some(SubmissionRefusalClass::Temporary),
                },
            }),
        ),
        (
            "mail",
            550,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Sender,
                    recipient_index: None,
                    reply_class: Some(SubmissionRefusalClass::Permanent),
                },
            }),
        ),
        (
            "recipient",
            450,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Recipient,
                    recipient_index: Some(0),
                    reply_class: Some(SubmissionRefusalClass::Temporary),
                },
            }),
        ),
        (
            "recipient",
            550,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Recipient,
                    recipient_index: Some(0),
                    reply_class: Some(SubmissionRefusalClass::Permanent),
                },
            }),
        ),
        (
            "data",
            451,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Message,
                    recipient_index: None,
                    reply_class: Some(SubmissionRefusalClass::Temporary),
                },
            }),
        ),
        (
            "data",
            554,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Message,
                    recipient_index: None,
                    reply_class: Some(SubmissionRefusalClass::Permanent),
                },
            }),
        ),
        ("final", 451, Ok(SubmissionOutcome::Unknown)),
        ("final", 554, Ok(SubmissionOutcome::Unknown)),
        ("final", 250, Ok(SubmissionOutcome::Accepted)),
    ] {
        let (mut client, server) = tokio::io::duplex(65536);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            let mut body_seen = false;
            server
                .get_mut()
                .write_all(b"220 synthetic peer\r\n")
                .await
                .unwrap();
            loop {
                let mut command = String::new();
                if server.read_line(&mut command).await.unwrap() == 0 {
                    return body_seen;
                }
                let stage = if command.starts_with("MAIL FROM:") {
                    "mail"
                } else if command.starts_with("RCPT TO:") {
                    "recipient"
                } else if command == "DATA\r\n" {
                    "data"
                } else {
                    "other"
                };
                if phase == stage {
                    server
                        .get_mut()
                        .write_all(format!("{refusal} synthetic refusal\r\n").as_bytes())
                        .await
                        .unwrap();
                } else if command.starts_with("EHLO ") {
                    server
                        .get_mut()
                        .write_all(b"250 synthetic peer\r\n")
                        .await
                        .unwrap();
                } else if stage == "data" {
                    server
                        .get_mut()
                        .write_all(b"354 continue\r\n")
                        .await
                        .unwrap();
                    loop {
                        let mut body = String::new();
                        assert!(server.read_line(&mut body).await.unwrap() > 0);
                        if body == ".\r\n" {
                            break;
                        }
                        body_seen = true;
                    }
                    server
                        .get_mut()
                        .write_all(format!("{refusal} synthetic result\r\n").as_bytes())
                        .await
                        .unwrap();
                } else {
                    server
                        .get_mut()
                        .write_all(b"250 accepted\r\n")
                        .await
                        .unwrap();
                }
            }
        });
        assert_eq!(response(&mut client).await.unwrap().0, 220);
        let extensions = Extensions::parse(&ehlo(&mut client).await.unwrap());
        let outcome = deliver(
            &mut client,
            &extensions,
            "sender@example.com",
            &["recipient@example.com".into()],
            ASCII,
            tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
        )
        .await;
        assert_eq!(outcome, expected);
        drop(client);
        assert_eq!(peer.await.unwrap(), phase == "final");
    }
}

#[tokio::test]
async fn missing_smtputf8_rejects_international_sender_and_recipient_before_mail() {
    for (from, to) in [
        ("δοκιμή@example.net", "recipient@example.net"),
        ("owner@example.net", "δοκιμή@example.net"),
    ] {
        let (outcome, peer) = exchange(&["8BITMIME"], from, to, ASCII, true).await;
        rejected_before_envelope(outcome, &peer);
    }
}
#[tokio::test]
async fn missing_smtputf8_rejects_top_and_nested_international_headers() {
    for wire in [
        "From: owner@example.net\r\nSubject: café\r\n\r\nASCII body\r\n",
        "From: owner@example.net\r\nContent-Type: multipart/mixed; boundary=part\r\n\r\n--part\r\nContent-Disposition: attachment; filename=résumé.txt\r\n\r\nASCII body\r\n--part--\r\n",
    ] {
        let (outcome, peer) = exchange(
            &["8BITMIME"],
            "owner@example.net",
            "recipient@example.net",
            wire,
            true,
        )
        .await;
        rejected_before_envelope(outcome, &peer);
    }
}
#[tokio::test]
async fn negotiated_utf8_and_eight_bit_are_declared_and_delivered_without_downgrading() {
    let wire = "From: δοκιμή@example.net\r\nSubject: café\r\n\r\nこんにちは\r\n";
    let (outcome, peer) = exchange(
        &["SMTPUTF8", "8BITMIME", "SIZE 1048576"],
        "δοκιμή@example.net",
        "recipient@example.net",
        wire,
        true,
    )
    .await;
    assert_eq!(outcome.unwrap(), SubmissionOutcome::Accepted);
    let mail = peer
        .commands
        .iter()
        .find(|s| s.starts_with("MAIL FROM:"))
        .unwrap();
    assert!(mail.starts_with("MAIL FROM:<δοκιμή@example.net> SIZE="));
    assert!(mail.contains(" SMTPUTF8"));
    assert!(mail.contains(" BODY=8BITMIME"));
    assert_eq!(peer.delivered, wire);
}
#[tokio::test]
async fn eight_bit_body_requires_eightbitmime_but_not_smtputf8_for_ascii_headers() {
    let wire = "From: owner@example.net\r\nSubject: ASCII\r\n\r\ncafé\r\n";
    let (outcome, peer) = exchange(
        &["SMTPUTF8"],
        "owner@example.net",
        "recipient@example.net",
        wire,
        true,
    )
    .await;
    rejected_before_envelope(outcome, &peer);
    let (outcome, peer) = exchange(
        &["8BITMIME"],
        "owner@example.net",
        "recipient@example.net",
        wire,
        true,
    )
    .await;
    assert_eq!(outcome.unwrap(), SubmissionOutcome::Accepted);
    let mail = peer
        .commands
        .iter()
        .find(|s| s.starts_with("MAIL FROM:"))
        .unwrap();
    assert!(mail.contains(" BODY=8BITMIME"));
    assert!(!mail.contains("SMTPUTF8"));
    assert_eq!(peer.delivered, wire);
}
#[tokio::test]
async fn ascii_mail_works_without_extensions_and_lost_data_acknowledgment_stays_unknown() {
    let (outcome, peer) = exchange(
        &[],
        "owner@example.net",
        "recipient@example.net",
        ASCII,
        true,
    )
    .await;
    assert_eq!(outcome.unwrap(), SubmissionOutcome::Accepted);
    assert_eq!(peer.commands[1], "MAIL FROM:<owner@example.net>\r\n");
    assert_eq!(peer.delivered, ASCII);
    let (outcome, peer) = exchange(
        &[],
        "owner@example.net",
        "recipient@example.net",
        ASCII,
        false,
    )
    .await;
    assert_eq!(outcome.unwrap(), SubmissionOutcome::Unknown);
    assert_eq!(peer.delivered, ASCII);
}

#[tokio::test]
async fn encoded_global_attachment_can_use_a_seven_bit_transport() {
    let wire = "From: owner@example.net\r\nContent-Type: multipart/mixed; boundary=part\r\n\r\n--part\r\nContent-Type: message/global\r\nContent-Transfer-Encoding: base64\r\n\r\nRnJvbTogb3duZXJAZXhhbXBsZS5uZXQNClN1YmplY3Q6IGNhZsOpDQoNCmJvZHkNCg==\r\n--part--\r\n";
    let (outcome, peer) = exchange(
        &[],
        "owner@example.net",
        "recipient@example.net",
        wire,
        true,
    )
    .await;
    assert_eq!(outcome.unwrap(), SubmissionOutcome::Accepted);
    assert_eq!(peer.commands[1], "MAIL FROM:<owner@example.net>\r\n");
    assert_eq!(peer.delivered, wire);
}

#[tokio::test]
async fn recipient_refusal_returns_without_waiting_for_connection_cleanup() {
    for code in [450, 550] {
        let (mut client, server) = tokio::io::duplex(4096);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            let mut command = String::new();
            server.read_line(&mut command).await.unwrap();
            assert_eq!(command, "MAIL FROM:<owner@example.net>\r\n");
            server
                .get_mut()
                .write_all(b"250 accepted\r\n")
                .await
                .unwrap();
            command.clear();
            server.read_line(&mut command).await.unwrap();
            assert_eq!(command, "RCPT TO:<recipient@example.net>\r\n");
            server
                .get_mut()
                .write_all(format!("{code} synthetic refusal\r\n").as_bytes())
                .await
                .unwrap();
            // Keep the peer open after its refusal. The discarded connection
            // must close without DATA, RSET or another round trip.
            command.clear();
            assert_eq!(server.read_line(&mut command).await.unwrap(), 0);
        });
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            deliver(
                &mut client,
                &Extensions::default(),
                "owner@example.net",
                &["recipient@example.net".into()],
                ASCII,
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            ),
        )
        .await
        .expect("a definitive refusal must not wait for cleanup");
        assert_eq!(
            result,
            Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Recipient,
                    recipient_index: Some(0),
                    reply_class: Some(if code < 500 {
                        SubmissionRefusalClass::Temporary
                    } else {
                        SubmissionRefusalClass::Permanent
                    })
                }
            })
        );
        drop(client);
        peer.await.unwrap();
    }
}

#[tokio::test]
async fn recipient_refusal_preserves_its_position_and_never_submits_to_accepted_recipients() {
    let (mut client, server) = tokio::io::duplex(4096);
    let peer = tokio::spawn(async move {
        let mut server = BufReader::new(server);
        let mut commands = Vec::new();
        loop {
            let mut line = String::new();
            if server.read_line(&mut line).await.unwrap() == 0 {
                break;
            }
            let refused = line == "RCPT TO:<refused@example.net>\r\n";
            commands.push(line);
            server
                .get_mut()
                .write_all(if refused {
                    b"550 recipient refused\r\n"
                } else {
                    b"250 accepted\r\n"
                })
                .await
                .unwrap();
        }
        commands
    });
    let result = deliver(
        &mut client,
        &Extensions::default(),
        "owner@example.net",
        &[
            "accepted@example.net".into(),
            "refused@example.net".into(),
            "later@example.net".into(),
        ],
        ASCII,
        tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
    )
    .await;
    drop(client);
    let commands = peer.await.unwrap();
    assert_eq!(commands.len(), 3);
    assert!(!commands.iter().any(|line| line == "DATA\r\n"));
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::json!({
            "Ok": {"rejected": {"refusal": {
                "phase": "recipient", "recipient_index": 1, "reply_class": "permanent"
            }}}
        })
    );
}
