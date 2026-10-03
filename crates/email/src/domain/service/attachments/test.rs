use super::*;
use crate::domain::models::{DeletedUserDraft, UserProvider};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use model_entity::EntityType;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
struct Calls(Mutex<Vec<String>>);

impl Calls {
    fn push(&self, call: impl Into<String>) {
        self.0.lock().unwrap().push(call.into());
    }
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

/// One fake behind every port, recording the order the use case drives them in.
#[derive(Default)]
struct Fake {
    calls: Calls,
    /// Bytes served per document id; a missing id is "not a file".
    files: Mutex<Vec<(String, Vec<u8>)>>,
    fail_storage: bool,
    draft_id: Uuid,
    thread_id: Uuid,
}

fn created(fake: &Fake, input: &CreateDraftInput) -> CreatedDraft {
    CreatedDraft {
        db_id: fake.draft_id,
        provider_id: None,
        replying_to_id: input.replying_to_id,
        provider_thread_id: Some("thread-provider".to_owned()),
        thread_db_id: fake.thread_id,
        link_id: Uuid::nil(),
        subject: input.subject.clone(),
        to: input.to.clone(),
        cc: input.cc.clone(),
        bcc: input.bcc.clone(),
        body_text: None,
        body_html: None,
        body_macro: None,
        headers_json: Some(serde_json::json!({"Macro-In-Reply-To": "x"})),
        send_time: input.send_time,
    }
}

impl DraftSendService for Fake {
    async fn create_draft(
        &self,
        _: &Link,
        _: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.calls.push("create_draft");
        assert!(input.db_id.is_none(), "the draft is minted by the service");
        Ok(created(self, &input))
    }

    async fn send_message(
        &self,
        _: &Link,
        _: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.calls.push(format!(
            "send:{}:{}",
            input.db_id.map(|id| id.to_string()).unwrap_or_default(),
            input
                .thread_db_id
                .map(|id| id.to_string())
                .unwrap_or_default()
        ));
        Ok(created(self, &input))
    }

    async fn delete_draft_for_user(
        &self,
        _: MacroUserIdStr<'_>,
        draft_id: Uuid,
    ) -> Result<DeletedUserDraft, EmailErr> {
        self.calls.push(format!("delete:{draft_id}"));
        Ok(DeletedUserDraft {
            thread_id: None,
            deleted: true,
            thread_deleted: true,
        })
    }
}

impl DraftAttachmentSource for Fake {
    async fn fetch_attachment(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SourcedAttachment, EmailErr> {
        let id = receipt.entity().entity_id.clone();
        self.calls.push(format!("fetch:{id}"));
        let files = self.files.lock().unwrap();
        let Some((_, bytes)) = files.iter().find(|(doc, _)| *doc == id) else {
            return Err(EmailErr::AttachmentUnavailable {
                name: id,
                reason: "it is a Macro document, not a file".to_owned(),
            });
        };
        Ok(SourcedAttachment {
            file_name: format!("{id}.pdf"),
            content_type: "application/pdf".to_owned(),
            bytes: bytes.clone(),
        })
    }
}

impl DraftAttachmentStorage for Fake {
    async fn put_attachment(&self, key: &str, content_type: &str, _: &[u8]) -> anyhow::Result<()> {
        self.calls.push(format!("put:{key}:{content_type}"));
        anyhow::ensure!(!self.fail_storage, "bucket unavailable");
        Ok(())
    }
}

impl DraftAttachmentRepo for Fake {
    type Err = anyhow::Error;

    async fn insert_draft_attachment(
        &self,
        link_id: Uuid,
        attachment: &AttachmentDraft,
    ) -> Result<(), Self::Err> {
        assert_eq!(link_id, link().id);
        assert_eq!(attachment.draft_id, self.draft_id);
        assert_eq!(
            attachment.s3_key,
            draft_attachment_key(self.draft_id, attachment.id)
        );
        assert_eq!(attachment.sha.len(), 64);
        self.calls.push(format!(
            "record:{}:{}:{}",
            attachment.file_name, attachment.content_type, attachment.size
        ));
        Ok(())
    }
}

fn link() -> Link {
    Link {
        id: Uuid::from_u128(0xd01),
        macro_id: MacroUserIdStr::parse_from_str("macro|sender@example.com").unwrap(),
        fusionauth_user_id: String::new(),
        email_address: EmailStr::try_from("sender@example.com".to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn input() -> CreateDraftInput {
    CreateDraftInput {
        db_id: None,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Report".to_owned(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: Some(MacroUserIdStr::parse_from_str("macro|sender@example.com").unwrap()),
        draft_client_binding: None,
        thread_client_binding: None,
    }
}

fn receipt(document_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|sender@example.com").unwrap(),
        document_id,
        EntityType::Document,
    )
}

fn sender(fake: Arc<Fake>) -> DraftAttachmentSender<Fake, Arc<Fake>, Arc<Fake>, Arc<Fake>> {
    DraftAttachmentSender::new(fake.clone(), fake.clone(), fake.clone(), fake)
}

fn fake_with(files: Vec<(&str, Vec<u8>)>) -> Arc<Fake> {
    Arc::new(Fake {
        files: Mutex::new(
            files
                .into_iter()
                .map(|(id, bytes)| (id.to_owned(), bytes))
                .collect(),
        ),
        draft_id: Uuid::from_u128(0xd5a),
        thread_id: Uuid::from_u128(0x7a),
        ..Default::default()
    })
}

#[tokio::test]
async fn no_attachments_is_a_plain_send() {
    let fake = fake_with(vec![]);
    sender(fake.clone())
        .send_message_with_attachments(&link(), &[link()], input(), vec![])
        .await
        .unwrap();
    assert_eq!(fake.calls.take(), ["send::"]);
}

#[tokio::test]
async fn stages_every_attachment_on_the_draft_then_sends_that_draft() {
    let fake = fake_with(vec![("a", vec![1, 2, 3]), ("b", vec![4])]);
    let sent = sender(fake.clone())
        .send_message_with_attachments(
            &link(),
            &[link()],
            input(),
            vec![receipt("a"), receipt("b")],
        )
        .await
        .unwrap();
    assert_eq!(sent.db_id, fake.draft_id);

    let calls = fake.calls.take();
    assert_eq!(&calls[..3], ["fetch:a", "fetch:b", "create_draft"]);
    assert!(calls[3].starts_with(&format!("put:draft/{}/", fake.draft_id)));
    assert!(calls[3].ends_with(":application/pdf"));
    assert_eq!(calls[4], "record:a.pdf:application/pdf:3");
    assert!(calls[5].starts_with("put:"));
    assert_eq!(calls[6], "record:b.pdf:application/pdf:1");
    assert_eq!(
        calls[7],
        format!("send:{}:{}", fake.draft_id, fake.thread_id),
        "the send targets the staged draft, not a fresh row"
    );
    assert_eq!(calls.len(), 8);
}

#[tokio::test]
async fn send_input_adopts_the_staged_drafts_thread_identity() {
    let fake = fake_with(vec![]);
    let draft = created(&fake, &input());
    let send_input = input_for_staged_draft(input(), &draft);
    assert_eq!(send_input.db_id, Some(fake.draft_id));
    assert_eq!(send_input.thread_db_id, Some(fake.thread_id));
    assert_eq!(send_input.provider_thread_id, draft.provider_thread_id);
    assert_eq!(send_input.headers_json, draft.headers_json);
}

#[tokio::test]
async fn a_document_that_is_not_a_file_fails_before_any_draft_exists() {
    let fake = fake_with(vec![("a", vec![1])]);
    let error = sender(fake.clone())
        .send_message_with_attachments(
            &link(),
            &[link()],
            input(),
            vec![receipt("a"), receipt("missing")],
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, EmailErr::AttachmentUnavailable { ref name, .. } if name == "missing"),
        "got {error:?}"
    );
    assert_eq!(fake.calls.take(), ["fetch:a", "fetch:missing"]);
}

#[tokio::test]
async fn oversized_attachments_are_refused_before_any_draft_exists() {
    let fake = fake_with(vec![
        ("a", vec![0; MAX_DRAFT_ATTACHMENTS_BYTES / 2 + 1]),
        ("b", vec![0; MAX_DRAFT_ATTACHMENTS_BYTES / 2 + 1]),
    ]);
    let error = sender(fake.clone())
        .send_message_with_attachments(
            &link(),
            &[link()],
            input(),
            vec![receipt("a"), receipt("b")],
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            error,
            EmailErr::AttachmentsTooLarge { total_bytes, limit_bytes }
                if total_bytes == MAX_DRAFT_ATTACHMENTS_BYTES + 2
                    && limit_bytes == MAX_DRAFT_ATTACHMENTS_BYTES
        ),
        "got {error:?}"
    );
    assert_eq!(fake.calls.take(), ["fetch:a", "fetch:b"]);
}

#[tokio::test]
async fn a_staging_failure_discards_the_draft_and_does_not_send() {
    let fake = Arc::new(Fake {
        fail_storage: true,
        ..Arc::try_unwrap(fake_with(vec![("a", vec![1])]))
            .ok()
            .unwrap()
    });
    let error = sender(fake.clone())
        .send_message_with_attachments(&link(), &[link()], input(), vec![receipt("a")])
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("bucket unavailable"),
        "got {error}"
    );

    let calls = fake.calls.take();
    assert_eq!(&calls[..2], ["fetch:a", "create_draft"]);
    assert!(calls[2].starts_with("put:"));
    assert_eq!(calls[3], format!("delete:{}", fake.draft_id));
    assert_eq!(calls.len(), 4, "nothing was sent: {calls:?}");
}

#[test]
fn the_attachment_key_matches_the_draft_attachment_api_layout() {
    let draft = Uuid::from_u128(1);
    let attachment = Uuid::from_u128(2);
    assert_eq!(
        draft_attachment_key(draft, attachment),
        format!("draft/{draft}/{attachment}")
    );
}
