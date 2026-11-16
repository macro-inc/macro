use email_api_client::domain::models::{
    AttachmentContent, DraftRequest, SendRequest, SubmissionOutcome, UploadProgress,
};
use email_api_client::domain::ports::{
    MailboxActionWriter, MailboxContentReader, MailboxDraftClient,
};
use models_email::email::service::address::ContactInfo;
use serde_json::json;
use uuid::Uuid;

use super::{ADA, BOB, id, message_id, start, token};
use crate::{Fault, FaultError, Route};

const TWO_MAILBOXES: &str = r#"
mailboxes:
  - email: ada@example.com
    name: Ada Example
    messages:
      - from: Bob Example <bob@example.com>
        subject: Lunch?
        text: Are you free on Friday?
        message_id: lunch-1@example.com
  - email: bob@example.com
    name: Bob Example
    messages:
      - from: Bob Example <bob@example.com>
        to: Ada Example <ada@example.com>
        subject: Lunch?
        text: Are you free on Friday?
        message_id: lunch-1@example.com
        folder: sentitems
"#;

fn request(subject: &str, html: &str) -> DraftRequest {
    let message = json!({
        "link_id": Uuid::now_v7(),
        "subject": subject,
        "body_html": html,
        "to": [{"email": BOB, "name": "Bob Example"}],
    });
    DraftRequest {
        reply_to: None,
        correlation: Uuid::now_v7(),
        revision: 1,
        content: SendRequest {
            message_id: None,
            message: serde_json::from_value(message).unwrap(),
            from: ContactInfo {
                email: ADA.into(),
                name: Some("Ada Example".into()),
                photo_url: None,
            },
            parent_message_id: None,
            references: None,
        },
    }
}

#[tokio::test]
async fn a_draft_is_created_found_by_correlation_updated_and_deleted() {
    let (emulator, api) = start(TWO_MAILBOXES).await;
    let token = token(&emulator, ADA);
    let mut request = request("Plan", "<p>First</p>");

    let created = api.create_draft(&token, &request).await.unwrap();
    assert!(created.is_draft);
    assert!(created.content_fingerprint.is_some());

    let found = api.find_drafts(&token, request.correlation).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, created.id);
    assert_eq!(found[0].app_revision, Some(1));
    assert_eq!(found[0].content_fingerprint, created.content_fingerprint);
    assert!(
        api.find_drafts(&token, Uuid::now_v7())
            .await
            .unwrap()
            .is_empty()
    );

    request.revision = 2;
    request.content.message.body_html = Some("<p>Second</p>".into());
    let version = created.version.clone().unwrap();
    let updated = api
        .update_draft(&token, &created.id, &request, &version)
        .await
        .unwrap();
    assert_ne!(updated.content_fingerprint, created.content_fingerprint);
    let read = api.get_draft(&token, &created.id).await.unwrap().unwrap();
    assert_eq!(read.app_revision, Some(2));

    // The first version no longer matches.
    let stale = api
        .update_draft(&token, &created.id, &request, &version)
        .await;
    assert!(stale.is_err());

    api.delete_draft(&token, &created.id, &updated.version.unwrap())
        .await
        .unwrap();
    assert!(api.get_draft(&token, &created.id).await.unwrap().is_none());
}

#[tokio::test]
async fn sending_a_draft_delivers_it_to_the_recipients_mailbox() {
    let (emulator, api) = start(TWO_MAILBOXES).await;
    let ada = token(&emulator, ADA);
    let request = request("Plan", "<p>See attached</p>");
    let draft = api.create_draft(&ada, &request).await.unwrap();
    let file = AttachmentContent {
        name: "plan.txt",
        content_type: "text/plain",
        content_id: "plan-1",
        inline: false,
        data: b"the plan",
    };
    api.add_attachment(&ada, &draft.id, file).await.unwrap();

    let outcome = api.submit_draft(&ada, &draft.id).await.unwrap();
    assert!(matches!(outcome, SubmissionOutcome::Accepted));

    let sent = emulator.messages(ADA).unwrap();
    let sent = sent.iter().find(|m| m.subject == "Plan").unwrap();
    assert_eq!(sent.id, draft.id.as_str());
    assert_eq!(sent.folder, "Sent Items");
    assert!(!sent.is_draft);

    // Bob reads it with the real client, attachment included.
    let bob = token(&emulator, BOB);
    let received = message_id(&emulator, BOB, "Plan");
    let folders = api.folders(&bob).await.unwrap();
    let read = api
        .message(&bob, Uuid::now_v7(), &received, &folders)
        .await
        .unwrap()
        .unwrap();
    assert!(read.state.in_inbox && !read.state.is_read);
    assert_eq!(read.content.message.from.as_ref().unwrap().email, ADA);
    assert_eq!(
        read.content.message.global_id,
        Some(sent.internet_message_id.clone())
    );
    let attachment = id(read.content.message.attachments[0]
        .provider_id
        .as_ref()
        .unwrap());
    let bytes = api.attachment(&bob, &received, &attachment).await.unwrap();
    assert_eq!(bytes, b"the plan");

    // Ada's copy reads as sent, by the flag that survives folder moves.
    let folders = api.folders(&ada).await.unwrap();
    let own = api
        .message(&ada, Uuid::now_v7(), &draft.id, &folders)
        .await
        .unwrap()
        .unwrap();
    assert!(own.content.message.is_sent);
    assert_eq!(own.draft_correlation, Some(request.correlation));
}

#[tokio::test]
async fn a_native_reply_joins_the_parents_conversation_on_both_sides() {
    let (emulator, api) = start(TWO_MAILBOXES).await;
    let ada = token(&emulator, ADA);
    let parent = message_id(&emulator, ADA, "Lunch?");
    let mut request = request("Re: Lunch?", "<p>Yes</p>");
    request.reply_to = Some(parent.clone());
    request.content.parent_message_id = Some("<lunch-1@example.com>".into());
    request.content.references = Some(vec!["<lunch-1@example.com>".into()]);

    let draft = api.create_draft(&ada, &request).await.unwrap();
    api.submit_draft(&ada, &draft.id).await.unwrap();

    let conversation = |email: &str, subject: &str| {
        let messages = emulator.messages(email).unwrap();
        let message = messages.iter().find(|m| m.subject == subject).unwrap();
        message.conversation_id.clone()
    };
    assert_eq!(draft.conversation_id.as_str(), conversation(ADA, "Lunch?"));
    assert_eq!(conversation(BOB, "Re: Lunch?"), conversation(BOB, "Lunch?"));
}

#[tokio::test]
async fn a_refused_native_reply_falls_back_to_a_standalone_draft() {
    let (emulator, api) = start(TWO_MAILBOXES).await;
    let ada = token(&emulator, ADA);
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesCreateReply),
        error: Some(FaultError::InvalidOperation),
        times: Some(1),
        ..Fault::default()
    });
    let mut request = request("Re: Lunch?", "<p>Yes</p>");
    request.reply_to = Some(message_id(&emulator, ADA, "Lunch?"));
    request.content.parent_message_id = Some("<lunch-1@example.com>".into());

    let draft = api.create_draft(&ada, &request).await.unwrap();

    // The RFC reply header still threads it with its parent.
    let messages = emulator.messages(ADA).unwrap();
    let parent = messages.iter().find(|m| m.subject == "Lunch?").unwrap();
    assert_eq!(draft.conversation_id.as_str(), parent.conversation_id);
    let routes: Vec<_> = emulator.requests().iter().filter_map(|r| r.route).collect();
    assert_eq!(
        routes,
        vec![Route::MessagesCreateReply, Route::MessagesCreate]
    );
}

#[tokio::test]
async fn a_large_attachment_uploads_in_ranges_and_resumes_from_the_servers_offset() {
    let (emulator, api) = start(TWO_MAILBOXES).await;
    let ada = token(&emulator, ADA);
    let draft = api
        .create_draft(&ada, &request("Big", "<p>Big</p>"))
        .await
        .unwrap();
    let data: Vec<u8> = (0..3_500_000u32).map(|n| (n % 251) as u8).collect();
    let file = AttachmentContent {
        name: "big.bin",
        content_type: "application/octet-stream",
        content_id: "big-1",
        inline: false,
        data: &data,
    };
    let total = data.len() as u64;
    let block = 5 * 320 * 1024;

    let session = api.create_upload(&ada, &draft.id, file).await.unwrap();
    assert_eq!(session.next_offset, 0);
    let progress = api
        .upload_range(&session.url, 0, total, &data[..block])
        .await
        .unwrap();
    let UploadProgress::Continue(checkpoint) = progress else {
        panic!("the first range does not complete the upload");
    };
    assert_eq!(checkpoint.next_offset, block as u64);
    let inspected = api.inspect_upload(&session.url).await.unwrap();
    assert_eq!(inspected.next_offset, block as u64);

    let progress = api
        .upload_range(&session.url, block as u64, total, &data[block..])
        .await
        .unwrap();
    assert!(matches!(progress, UploadProgress::Complete));

    let attachments = api.draft_attachments(&ada, &draft.id).await.unwrap();
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0].name, "big.bin");
    assert_eq!(attachments[0].size, total);
    assert_eq!(attachments[0].content_id.as_deref(), Some("big-1"));
    let bytes = api
        .attachment(&ada, &draft.id, &attachments[0].id)
        .await
        .unwrap();
    assert_eq!(bytes, data);

    api.delete_attachment(&ada, &draft.id, &attachments[0].id)
        .await
        .unwrap();
    assert!(
        api.draft_attachments(&ada, &draft.id)
            .await
            .unwrap()
            .is_empty()
    );
}
