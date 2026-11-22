//! Journeys through the real IMAP engine, Dovecot and authenticated submission.

use email_e2e::{DEFAULT_TIMEOUT, Mail, Report, Stack, StackOptions, User, eventually};
use reqwest::Method;
use rootcause::prelude::*;
use serde_json::{Value, json};
use uuid::Uuid;

async fn preview(user: &User, link: Uuid, view: &str, subject: &str) -> Result<Value, Report> {
    eventually(
        "the IMAP thread in the public API",
        DEFAULT_TIMEOUT,
        async || {
            let listed = user
                .get(&format!("/email/threads/previews/cursor/{view}?limit=100"))
                .await?
                .ok()?;
            Ok(listed["items"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|item| item["linkId"] == link.to_string() && item["name"] == subject)
                .cloned())
        },
    )
    .await
}

/// Connects through user authorization, reads independently injected MIME,
/// proves account isolation, and sends through real authenticated SMTP.
#[tokio::test(flavor = "multi_thread")]
async fn imap_connect_receive_isolate_and_send() -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        imap: true,
        ..Default::default()
    })
    .await?;
    let alice = stack.unique_user("imap-alice").await?;
    let bob = stack.unique_user("imap-bob").await?;
    let lab = stack.imap_lab()?;
    let suggestion = alice.get("/email/links/suggestion").await?.ok()?;
    assert_eq!(suggestion["email"], alice.email());
    alice
        .post(
            "/email/links/imap/discover",
            Some(&json!({"email":alice.email()})),
        )
        .await?
        .ok()?;
    let received_subject = format!("Real IMAP {}", Uuid::now_v7());
    let delivered = lab
        .deliver(
            alice.email(),
            &Mail::new(
                "Grace <grace@example.net>",
                &received_subject,
                "Real MIME survives the full provider path.",
            )
            .with_attachment(
                "proof.bin",
                "application/octet-stream",
                &[0, 1, 127, 128, 255],
            ),
        )
        .await?;
    let mut rejected = lab.connect_request(alice.email());
    rejected["imap"]["password"] = json!("wrong-lab-password");
    let rejected = alice.post("/email/links/imap", Some(&rejected)).await?;
    assert_eq!(rejected.status, 422, "{}", rejected.text);
    let mut rejected_submission = lab.connect_request(alice.email());
    rejected_submission["smtp"]["password"] = json!("wrong-submission-password");
    let rejected_submission = alice
        .post("/email/links/imap", Some(&rejected_submission))
        .await?;
    assert_eq!(
        rejected_submission.status, 422,
        "{}",
        rejected_submission.text
    );
    let unverified = alice
        .post("/email/links/imap", Some(&lab.connect_request(bob.email())))
        .await?;
    assert_eq!(unverified.status, 403, "{}", unverified.text);
    let alice_link = alice.link_imap().await?;
    let bob_link = bob.link_imap().await?;
    let incoming = preview(&alice, alice_link, "inbox", &received_subject).await?;
    assert_eq!(incoming["isRead"], false);
    let thread_id = incoming["id"]
        .as_str()
        .ok_or_else(|| report!("IMAP preview omitted its thread id"))?;
    let thread = alice
        .get(&format!("/email/threads/{thread_id}?limit=100"))
        .await?
        .ok()?;
    assert!(
        thread["thread"]["messages"][0]["body_text"]
            .as_str()
            .unwrap_or_default()
            .contains("Real MIME survives"),
        "{thread}"
    );
    let attachment = &thread["thread"]["messages"][0]["attachments"][0];
    assert_eq!(attachment["filename"], "proof.bin", "{thread}");
    let attachment_id = attachment["db_id"]
        .as_str()
        .ok_or_else(|| report!("received attachment omitted its database id"))?;
    let attachment_read = alice
        .get(&format!("/email/attachments/{attachment_id}"))
        .await?
        .ok()?;
    let download_url = attachment_read["attachment"]["data_url"]
        .as_str()
        .ok_or_else(|| report!("received attachment omitted download URL"))?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    assert_eq!(
        http.get(download_url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .as_ref(),
        &[0, 1, 127, 128, 255]
    );
    let cross_account_attachment = bob
        .get(&format!("/email/attachments/{attachment_id}"))
        .await?;
    assert!(matches!(cross_account_attachment.status, 403 | 404));
    let settings_path = format!("/email/links/{alice_link}/imap/settings");
    let settings = alice.get(&settings_path).await?.ok()?;
    assert!(
        !serde_json::to_string(&settings)?
            .to_ascii_lowercase()
            .contains("password")
    );
    let other_settings = bob.get(&settings_path).await?;
    assert!(matches!(other_settings.status, 403 | 404));
    let update = json!(
    {
        "expectedRevision": settings[
            "revision"
        ],
        "roleOverrides": {
        },
        "excludedFolderIds": [
        ],
        "watchedFolderIds": [
        ]
    }
    );
    alice
        .request(Method::PATCH, &settings_path, None, Some(&update))
        .await?
        .ok()?;
    let stale_settings = alice
        .request(Method::PATCH, &settings_path, None, Some(&update))
        .await?;
    assert_eq!(stale_settings.status, 409, "{}", stale_settings.text);
    let other_edit = bob
        .request(Method::PATCH, &settings_path, None, Some(&update))
        .await?;
    assert!(matches!(other_edit.status, 403 | 404));

    let forbidden = bob
        .get(&format!("/email/threads/{thread_id}?limit=100"))
        .await?;
    assert!(
        matches!(forbidden.status, 401 | 403 | 404),
        "{}: {}",
        forbidden.status,
        forbidden.text
    );
    let bob_threads = bob
        .get("/email/threads/previews/cursor/inbox?limit=100")
        .await?
        .ok()?;
    assert!(
        !bob_threads["items"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|item| item["name"] == received_subject)
    );
    assert!(
        lab.messages(bob.email())
            .await
            .context("independent isolation read before any mailbox mutation")?
            .as_array()
            .is_some_and(Vec::is_empty)
    );
    assert_ne!(alice_link, bob_link);

    alice
        .request(
            Method::PATCH,
            &format!("/email/threads/{thread_id}/state"),
            Some(alice_link),
            Some(&json!({"field":"read","value":true})),
        )
        .await?
        .ok()?;
    let provider_message_id = delivered["messageId"]
        .as_str()
        .ok_or_else(|| report!("provider oracle omitted Message-ID"))?;
    eventually(
        "Macro's read state at the real provider",
        DEFAULT_TIMEOUT,
        async || {
            let messages = lab
                .messages(alice.email())
                .await
                .context("independent read-state check before the scenario requests Archive")?;
            Ok(messages
                .as_array()
                .into_iter()
                .flatten()
                .any(|message| {
                    message["messageId"] == provider_message_id && message["read"] == true
                })
                .then_some(()))
        },
    )
    .await?;
    lab.set_read(alice.email(), provider_message_id, false)
        .await
        .context("independent unread write before the scenario requests Archive")?;
    eventually(
        "another client's unread change in Macro",
        DEFAULT_TIMEOUT,
        async || {
            let listed = alice
                .get("/email/threads/previews/cursor/inbox?limit=100")
                .await?
                .ok()?;
            Ok(listed["items"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|item| item["id"] == thread_id && item["isRead"] == false)
                .then_some(()))
        },
    )
    .await?;
    alice
        .request(
            Method::PATCH,
            &format!("/email/threads/{thread_id}/archived"),
            Some(alice_link),
            Some(&json!({"value":true})),
        )
        .await?
        .ok()?;
    eventually(
        "Macro's archive at the real provider",
        DEFAULT_TIMEOUT,
        async || {
            let messages = lab
                .messages(alice.email())
                .await
                .context("independent Archive check after the scenario requested archived=true")?;
            let matches: Vec<_> = messages
                .as_array()
                .into_iter()
                .flatten()
                .filter(|message| message["messageId"] == provider_message_id)
                .collect();
            Ok((matches.len() == 1 && matches[0]["folder"] == "Archive").then_some(()))
        },
    )
    .await?;

    let sent_subject = format!("Real SMTP {}", Uuid::now_v7());
    alice
        .request(
            Method::POST,
            "/email/messages",
            Some(alice_link),
            Some(&json!(
            {
                "message": {
                    "subject": sent_subject,
                    "to": [
                        {
                            "email": "recipient@example.net"
                        }
                    ],
                    "bcc": [
                        {
                            "email": "blind@example.net"
                        }
                    ],
                    "body_text": "Sent through the account's own SMTP submission."
                }
            }
            )),
        )
        .await?
        .ok()?;
    eventually(
        "one real SMTP delivery in Mailpit",
        DEFAULT_TIMEOUT,
        async || {
            let captured = lab.received().await?;
            let count = captured["messages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|message| message["Subject"] == sent_subject)
                .count();
            if count > 1 {
                bail!("SMTP submission duplicated a message");
            }
            Ok((count == 1).then_some(()))
        },
    )
    .await?;
    let captured = lab.received().await?;
    let captured = captured["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|message| message["Subject"] == sent_subject)
        .ok_or_else(|| report!("SMTP capture disappeared"))?;
    // Mailpit deliberately synthesizes a Bcc display header from envelope-only
    // recipients. Inspect the real relay's original DATA instead of that rewrite.
    let original = eventually(
        "the real relay's original SMTP DATA",
        DEFAULT_TIMEOUT,
        async || lab.submission_mime(&sent_subject).await,
    )
    .await?;
    assert!(!original["headerNames"].as_array().into_iter().flatten().filter_map(Value::as_str).any(|name| name.eq_ignore_ascii_case("bcc") || name.eq_ignore_ascii_case("resent-bcc")));
    use base64::Engine;
    let original = base64::engine::general_purpose::STANDARD.decode(
        original["mimeBase64"]
            .as_str()
            .ok_or_else(|| report!("relay capture has no original MIME"))?,
    )?;
    assert!(!String::from_utf8_lossy(&original).contains("blind@example.net"));
    assert!(
        captured["Bcc"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|recipient| recipient["Address"] == "blind@example.net"),
        "blind envelope recipient missing: {captured}"
    );
    preview(&alice, alice_link, "sent", &sent_subject).await?;
    let copies = lab.messages(alice.email()).await?;
    assert_eq!(
        copies
            .as_array()
            .into_iter()
            .flatten()
            .filter(|message| message["subject"] == sent_subject)
            .count(),
        1,
        "{copies}"
    );
    let mut reconnect = lab.connect_request(alice.email());
    reconnect["linkId"] = json!(alice_link);
    let reconnected = alice
        .post("/email/links/imap", Some(&reconnect))
        .await?
        .ok()?;
    assert_eq!(reconnected["linkId"], alice_link.to_string());
    preview(&alice, alice_link, "sent", &sent_subject).await?;
    alice
        .delete(&format!("/email/links/{alice_link}"), None)
        .await?
        .ok()?;
    eventually(
        "the disconnected account unavailable to its owner",
        DEFAULT_TIMEOUT,
        async || {
            let settings = alice.get(&settings_path).await?;
            Ok((settings.status == 404).then_some(()))
        },
    )
    .await?;
    let bob_settings = bob
        .get(&format!("/email/links/{bob_link}/imap/settings"))
        .await?
        .ok()?;
    assert!(bob_settings["folders"].is_array());
    stack.finish().await
}
