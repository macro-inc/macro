//! What the maintenance Lambdas do: the daily sweep of unfinished sign-ins,
//! the daily cleanup of stored attachment files, and the recording of
//! bounces and complaints about mail Macro sent.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the scenarios seed sign-in rows and read rows the API does not show"
)]

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use email_e2e::{
    ApiResponse, DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, User, eventually,
    gmail_emulator, outlook_emulator,
};
use rootcause::prelude::*;
use serde_json::{Value, json};
use uuid::Uuid;

/// The scope every Gmail inbox is linked with.
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
/// The queue the deletions of stored files travel on.
const SFS_DELETE: &str = "sfs-delete";
/// A one-pixel PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

/// Records a sign-in at the provider for `address` that the user began
/// `hours_ago` and has not finished in Macro, the way the authentication
/// service records it, and returns the attempt's id: what the client would
/// pass to `POST /email/init`. The provider holds the mailbox and the grant,
/// so the attempt could still be finished.
async fn begin_sign_in(
    stack: &Stack,
    user: &User,
    provider: Provider,
    address: &str,
    hours_ago: i32,
) -> Result<Uuid, Report> {
    let attempt = Uuid::now_v7();
    let scopes: Vec<String> = match provider {
        Provider::Gmail => {
            stack.gmail().add_mailbox(&gmail_emulator::SeedMailbox {
                email: address.to_owned(),
                ..Default::default()
            })?;
            vec![GMAIL_SCOPE.to_owned()]
        }
        Provider::Outlook => {
            stack
                .outlook()
                .add_mailbox(&outlook_emulator::SeedMailbox {
                    email: address.to_owned(),
                    ..Default::default()
                })?;
            stack
                .outlook()
                .link_mailbox(&attempt.to_string(), address)?;
            Vec::new()
        }
    };
    sqlx::query(
        "INSERT INTO in_progress_user_link \
             (id, macro_user_id, linked_email, email_provider, requested_google_scopes, \
              granted_google_scopes, created_at) \
         VALUES ($1, $2, $3, $4::email_user_provider_enum, $5, $5, \
                 (now() AT TIME ZONE 'utc') - make_interval(hours => $6))",
    )
    .bind(attempt)
    .bind(user.fusion_id())
    .bind(address)
    .bind(provider.as_str())
    .bind(scopes)
    .bind(hours_ago)
    .execute(stack.db())
    .await?;
    Ok(attempt)
}

/// `POST /email/init` for a sign-in, as the client calls it to finish one.
async fn finish_sign_in(user: &User, attempt: Uuid) -> Result<ApiResponse, Report> {
    user.post(&format!("/email/init?link_id={attempt}"), None)
        .await
}

/// The unfinished sign-ins a user has.
async fn open_sign_ins(stack: &Stack, user: &User) -> Result<Vec<Uuid>, Report> {
    let attempts: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM in_progress_user_link WHERE macro_user_id = $1 ORDER BY id",
    )
    .bind(user.fusion_id())
    .fetch_all(stack.db())
    .await?;
    Ok(attempts)
}

/// The addresses `GET /email/links` lists for a user, sorted.
async fn listed_addresses(user: &User) -> Result<Vec<String>, Report> {
    let listed = user.get("/email/links").await?.ok()?;
    let mut addresses: Vec<String> = listed["links"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|link| link["email_address"].as_str().map(str::to_owned))
        .collect();
    addresses.sort();
    Ok(addresses)
}

/// A sign-in the user walked away from a day ago is removed by the daily
/// sweep and can no longer be finished, while one begun today stays and
/// still becomes an inbox, and the inbox the user already has is untouched.
/// When this fails, abandoned sign-ins stay for ever and a stale one can
/// still be turned into an inbox, or the sweep takes a sign-in the user is
/// in the middle of.
async fn abandoned_sign_in_is_swept(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let abandoned = begin_sign_in(&stack, &ada, provider, "ada.old@example.com", 25).await?;
    let recent = begin_sign_in(&stack, &ada, provider, "ada.work@example.com", 1).await?;
    let mut begun = vec![abandoned, recent];
    begun.sort();
    assert_eq!(open_sign_ins(&stack, &ada).await?, begun);

    stack.run_link_cleanup().await?;

    assert_eq!(open_sign_ins(&stack, &ada).await?, [recent]);
    let refused = finish_sign_in(&ada, abandoned).await?;
    assert!(
        refused.status >= 400,
        "finishing the swept sign-in answered {} {}",
        refused.status,
        refused.text
    );
    assert_eq!(listed_addresses(&ada).await?, [ada.email()]);

    // The one begun today is still there to finish.
    let linked = finish_sign_in(&ada, recent).await?.ok()?;
    if provider == Provider::Outlook {
        // Token requests name the link from here on.
        stack.outlook().link_attempt(
            linked["link_id"].as_str().unwrap_or_default(),
            &recent.to_string(),
        )?;
    }
    assert_eq!(
        listed_addresses(&ada).await?,
        ["ada.work@example.com", ada.email()]
    );
    assert_eq!(open_sign_ins(&stack, &ada).await?, Vec::<Uuid>::new());

    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "After the sweep",
        "Still here.",
    ))?;
    inbox.wait_for_preview("inbox", "After the sweep").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_abandoned_sign_in_is_swept() -> Result<(), Report> {
    abandoned_sign_in_is_swept(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_abandoned_sign_in_is_swept() -> Result<(), Report> {
    abandoned_sign_in_is_swept(Provider::Outlook).await
}

/// Writes a draft holding one image in the provider's own composer, and
/// returns what the provider calls it.
async fn write_draft_with_image(
    stack: &Stack,
    inbox: &Inbox,
    subject: &str,
) -> Result<String, Report> {
    let content_id = format!("{}@example.com", Uuid::now_v7().simple());
    let html = format!("<p>{subject}</p><img src=\"cid:{content_id}\" alt=\"picture\">");
    let image = STANDARD.encode(PNG);
    match inbox.provider() {
        Provider::Gmail => {
            let raw = format!(
                "From: {from}\r\nTo: grace@example.com\r\nSubject: {subject}\r\n\
                 MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"rel\"\r\n\r\n\
                 --rel\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html}\r\n\
                 --rel\r\nContent-Type: image/png; name=\"picture.png\"\r\n\
                 Content-Transfer-Encoding: base64\r\nContent-ID: <{content_id}>\r\n\
                 Content-Disposition: inline; filename=\"picture.png\"\r\n\r\n{image}\r\n--rel--\r\n",
                from = inbox.email(),
            );
            let saved: Value = reqwest::Client::new()
                .post(format!("{}/users/me/drafts", stack.gmail().gmail_url()))
                .bearer_auth(stack.gmail().access_token(inbox.email())?)
                .json(&json!({ "message": { "raw": URL_SAFE_NO_PAD.encode(raw) } }))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            saved["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| report!("Gmail saved a draft without an id: {saved}"))
        }
        Provider::Outlook => {
            let draft = stack.outlook().deliver(
                inbox.email(),
                &outlook_emulator::NewMessage {
                    to: Some("grace@example.com".to_owned()),
                    subject: Some(subject.to_owned()),
                    html: Some(html),
                    folder: Some("drafts".to_owned()),
                    attachments: vec![outlook_emulator::NewAttachment {
                        filename: "picture.png".to_owned(),
                        mime_type: Some("image/png".to_owned()),
                        base64: Some(image),
                        content_id: Some(content_id),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            )?;
            Ok(draft.id)
        }
    }
}

/// Discards a draft in the provider's own composer.
async fn discard_at_provider(stack: &Stack, inbox: &Inbox, draft: &str) -> Result<(), Report> {
    let (url, token) = match inbox.provider() {
        Provider::Gmail => (
            format!("{}/users/me/drafts/{draft}", stack.gmail().gmail_url()),
            stack.gmail().access_token(inbox.email())?,
        ),
        Provider::Outlook => (
            format!("{}/me/messages/{draft}", stack.outlook().graph_url()),
            stack.outlook().access_token(inbox.email())?,
        ),
    };
    let discarded = reqwest::Client::new()
        .delete(url)
        .bearer_auth(token)
        .send()
        .await?;
    if !discarded.status().is_success() {
        bail!(
            "discarding the draft at the provider answered {}",
            discarded.status()
        );
    }
    Ok(())
}

/// Takes the one image out of a draft in Outlook's own composer.
async fn remove_image_in_outlook(stack: &Stack, inbox: &Inbox, draft: &str) -> Result<(), Report> {
    let outlook = stack.outlook();
    let http = reqwest::Client::new();
    let attachments = format!("{}/me/messages/{draft}/attachments", outlook.graph_url());
    let listed: Value = http
        .get(&attachments)
        .bearer_auth(outlook.access_token(inbox.email())?)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let Some(image) = listed["value"][0]["id"].as_str() else {
        bail!("the draft holds no attachment in Outlook: {listed}");
    };
    let removed = http
        .delete(format!("{attachments}/{image}"))
        .bearer_auth(outlook.access_token(inbox.email())?)
        .send()
        .await?;
    if !removed.status().is_success() {
        bail!(
            "removing the image in Outlook answered {}",
            removed.status()
        );
    }
    Ok(())
}

/// Waits until Macro has stored the image of the draft named `subject` for
/// the app, and returns the draft's thread and the id the static file
/// service knows the copy by.
async fn stored_image(inbox: &Inbox, subject: &str) -> Result<(String, String), Report> {
    // A draft written in Gmail is listed with all mail, not under Drafts.
    let preview = inbox.wait_for_preview("all", subject).await?;
    let thread_id = preview["id"].as_str().unwrap_or_default().to_owned();
    let thread = inbox
        .wait_for_thread(
            &thread_id,
            "the draft's image to be stored for the app",
            |thread| thread["messages"][0]["attachments"][0]["sfs_id"].is_string(),
        )
        .await?;
    let file = thread["messages"][0]["attachments"][0]["sfs_id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    Ok((thread_id, file))
}

/// How often the static file service was asked to delete a file.
fn deletions_asked(stack: &Stack, file: &str) -> usize {
    stack
        .service_requests()
        .iter()
        .filter(|request| {
            request.service == "static-files"
                && request.method == "DELETE"
                && request.path.contains(file)
        })
        .count()
}

/// How many records say a stored file belongs to the mail.
async fn file_records(stack: &Stack, file: &str) -> Result<i64, Report> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_attachments_sfs WHERE sfs_id = $1::uuid")
            .bind(file)
            .fetch_one(stack.db())
            .await?;
    Ok(count)
}

/// How a draft's stored image stops being used.
#[derive(Clone, Copy, PartialEq)]
enum Dropped {
    /// The whole draft is discarded.
    Draft,
    /// The image is taken out of the draft, which stays.
    Image,
}

/// The image Macro stored for a draft is deleted from file storage by the
/// daily cleanup once the draft no longer holds it, and the image of
/// another draft is left alone. When this fails, the files of discarded
/// drafts stay in storage for ever, or the cleanup deletes a file a draft
/// still shows.
async fn unused_stored_file_is_deleted(provider: Provider, dropped: Dropped) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;

    let dropping = write_draft_with_image(&stack, &inbox, "Never mind").await?;
    write_draft_with_image(&stack, &inbox, "Still writing").await?;
    let (dropping_thread, dropped_file) = stored_image(&inbox, "Never mind").await?;
    let (_, kept_file) = stored_image(&inbox, "Still writing").await?;
    assert_ne!(dropped_file, kept_file);

    // Nothing is deleted while both drafts hold their image.
    stack.run_stored_file_cleanup().await?;

    match dropped {
        Dropped::Draft => {
            discard_at_provider(&stack, &inbox, &dropping).await?;
            eventually(
                "the discarded draft to leave the mail",
                DEFAULT_TIMEOUT,
                async || {
                    let listed = inbox.previews("all").await?;
                    Ok(listed
                        .iter()
                        .all(|preview| preview["name"] != "Never mind")
                        .then_some(()))
                },
            )
            .await?;
        }
        Dropped::Image => {
            remove_image_in_outlook(&stack, &inbox, &dropping).await?;
            inbox
                .wait_for_thread(&dropping_thread, "the draft to lose its image", |thread| {
                    thread["messages"][0]["attachments"]
                        .as_array()
                        .is_some_and(Vec::is_empty)
                })
                .await?;
        }
    }

    stack.run_stored_file_cleanup().await?;
    eventually(
        "the unused file to be deleted",
        DEFAULT_TIMEOUT,
        async || {
            Ok((deletions_asked(&stack, &dropped_file) > 0
                && file_records(&stack, &dropped_file).await? == 0
                && stack.queue_depth(SFS_DELETE).await? == 0)
                .then_some(()))
        },
    )
    .await?;
    assert_eq!(deletions_asked(&stack, &dropped_file), 1);

    // Every deletion the cleanups asked for is done: the other draft's
    // file was not among them.
    assert_eq!(deletions_asked(&stack, &kept_file), 0);
    assert_eq!(file_records(&stack, &kept_file).await?, 1);
    assert_eq!(stored_image(&inbox, "Still writing").await?.1, kept_file);
    assert_eq!(stack.dead_letters(SFS_DELETE).await?, 0);

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_stored_file_of_a_discarded_draft_is_deleted() -> Result<(), Report> {
    unused_stored_file_is_deleted(Provider::Gmail, Dropped::Draft).await
}

/// An Outlook draft that is discarded stays as a marker that it is gone,
/// and keeps its stored image with it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: outlook-discarded-draft-file-kept"]
async fn outlook_stored_file_of_a_discarded_draft_is_deleted() -> Result<(), Report> {
    unused_stored_file_is_deleted(Provider::Outlook, Dropped::Draft).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_stored_file_of_an_image_removed_from_a_draft_is_deleted() -> Result<(), Report> {
    unused_stored_file_is_deleted(Provider::Outlook, Dropped::Image).await
}

/// The mail-sending service's notice that mail to `address` bounced.
fn bounce(kind: &str, sub_kind: &str, address: &str) -> Value {
    json!({
        "notificationType": "Bounce",
        "bounce": {
            "bounceType": kind,
            "bounceSubType": sub_kind,
            "bouncedRecipients": [{ "emailAddress": address }],
            "timestamp": "2026-01-01T00:00:00.000Z",
            "feedbackId": Uuid::now_v7(),
        },
    })
}

/// The mail-sending service's notice that the reader at `address` reported
/// mail from Macro, with the kind of report the reader's provider gave.
fn complaint(kind: &str, address: &str) -> Value {
    json!({
        "notificationType": "Complaint",
        "complaint": {
            "complainedRecipients": [{ "emailAddress": address }],
            "timestamp": "2026-01-01T00:00:00.000Z",
            "feedbackId": Uuid::now_v7(),
            "complaintFeedbackType": kind,
        },
    })
}

/// The addresses Macro no longer sends its own mail to, sorted.
async fn suppressed(stack: &Stack) -> Result<Vec<String>, Report> {
    let addresses: Vec<String> =
        sqlx::query_scalar(r#"SELECT email FROM "BlockedEmail" ORDER BY email"#)
            .fetch_all(stack.db())
            .await?;
    Ok(addresses)
}

/// An address whose mail from Macro bounced for good, and one whose reader
/// reported that mail as abuse, are put on the list of addresses Macro does
/// not send to, in lower case and once; a full mailbox and a "not spam"
/// report put nobody on it, and the inbox at the bounced address goes on
/// working. When this fails, Macro keeps sending to dead addresses and to
/// readers who complained, or stops sending to an address over a passing
/// fault.
async fn bounced_and_reported_addresses_are_suppressed(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    assert_eq!(suppressed(&stack).await?, Vec::<String>::new());

    // Passing faults and a reader's "this is not spam" suppress nobody.
    stack
        .notify_of_mail_feedback(&bounce("Transient", "MailboxFull", "full@example.com"))
        .await?;
    stack
        .notify_of_mail_feedback(&complaint("not-spam", "content@example.com"))
        .await?;
    assert_eq!(suppressed(&stack).await?, Vec::<String>::new());

    let shouted = ada.email().to_uppercase();
    stack
        .notify_of_mail_feedback(&bounce("Permanent", "General", &shouted))
        .await?;
    assert_eq!(suppressed(&stack).await?, [ada.email()]);
    stack
        .notify_of_mail_feedback(&complaint("abuse", "annoyed@example.com"))
        .await?;
    // A second bounce of the same address changes nothing.
    stack
        .notify_of_mail_feedback(&bounce("Permanent", "General", ada.email()))
        .await?;
    let mut expected = vec![ada.email().to_owned(), "annoyed@example.com".to_owned()];
    expected.sort();
    assert_eq!(suppressed(&stack).await?, expected);

    // The list is about mail Macro sends; the user's own inbox is not on hold.
    inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "After the bounce",
        "Still arriving.",
    ))?;
    inbox.wait_for_preview("inbox", "After the bounce").await?;

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_bounced_and_reported_addresses_are_suppressed() -> Result<(), Report> {
    bounced_and_reported_addresses_are_suppressed(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_bounced_and_reported_addresses_are_suppressed() -> Result<(), Report> {
    bounced_and_reported_addresses_are_suppressed(Provider::Outlook).await
}
