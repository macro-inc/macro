//! Drafts that change in Outlook, driven through the real Outlook adapter
//! against the Outlook emulator. A mailbox stamps drafts on its own (an add-in,
//! a label policy), which moves the version and leaves the content: such a
//! draft still syncs and sends. An edit also changes the content, and Macro
//! neither overwrites nor sends it.

use super::*;
use crate::domain::mailbox::drafts::{MailboxDraftService, ports::*};
use email_api_client::{
    OutlookApiClientRepository,
    domain::{
        models::*,
        ports::{AlwaysAllowRateLimiter, MailboxTokenSource},
        service::mailbox::MailboxApiService,
    },
};
use macro_service_urls::MicrosoftGraphUrl;
use models_email::service::{address::ContactInfo, message::MessageToSend};
use outlook_emulator::{MessageChange, OutlookEmulator, Seed};
use std::sync::{Arc, Mutex};

const ADA: &str = "outlook-test@example.com";

struct Token(String);
impl MailboxTokenSource for Token {
    async fn access_token(
        &self,
        _: MailboxAccess,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new(self.0.clone()))
    }
}

type Change = Box<dyn FnMut() + Send>;

#[derive(Clone)]
struct Graph {
    api: Arc<MailboxApiService<OutlookApiClientRepository, Token, AlwaysAllowRateLimiter>>,
    before_read: Arc<Mutex<Option<Change>>>,
    before_update: Arc<Mutex<Option<Change>>>,
}

fn run(change: &Mutex<Option<Change>>) {
    if let Some(change) = change.lock().unwrap().as_mut() {
        change();
    }
}

fn access(mailbox: MailboxKey) -> MailboxAccess {
    MailboxAccess {
        link_id: mailbox.link_id,
        sync_generation: mailbox.sync_generation,
        grant_generation: mailbox.grant_generation,
    }
}

impl DraftGateway for Graph {
    async fn get_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        run(&self.before_read);
        self.api.get_draft(access(mailbox), id).await
    }
    async fn find_drafts(
        &self,
        mailbox: MailboxKey,
        id: Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        self.api.find_drafts(access(mailbox), id).await
    }
    async fn create_draft(
        &self,
        mailbox: MailboxKey,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        self.api.create_draft(access(mailbox), request).await
    }
    async fn update_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        request: &DraftRequest,
        version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        run(&self.before_update);
        self.api
            .update_draft(access(mailbox), id, request, version)
            .await
    }
    async fn delete_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        version: &str,
    ) -> Result<(), EmailApiError> {
        self.api.delete_draft(access(mailbox), id, version).await
    }
    async fn attachments(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        self.api.draft_attachments(access(mailbox), id).await
    }
    async fn add_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        self.api.add_attachment(access(mailbox), id, content).await
    }
    async fn delete_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        self.api
            .delete_attachment(access(mailbox), id, attachment)
            .await
    }
    async fn create_upload(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        self.api.create_upload(access(mailbox), id, content).await
    }
    async fn inspect_upload(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        self.api.inspect_upload(access(mailbox), url).await
    }
    async fn upload_range(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        self.api
            .upload_range(access(mailbox), url, offset, total, bytes)
            .await
    }
    async fn submit_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        self.api.submit(access(mailbox), id).await
    }
}

/// The lease's own content, with no attachments or reply parent to resolve.
struct Content;
impl DraftMaterializer for Content {
    async fn prepare_draft(&self, lease: &DraftLease) -> Result<PreparedDraft, MailboxError> {
        Ok(PreparedDraft {
            reply_to: None,
            request: SendRequest {
                message_id: None,
                message: MessageToSend {
                    db_id: Some(lease.message_id),
                    provider_id: None,
                    replying_to_id: None,
                    provider_thread_id: None,
                    thread_db_id: None,
                    link_id: lease.mailbox.link_id,
                    subject: lease.input.subject.clone(),
                    to: Some(vec![ContactInfo {
                        email: "grace@example.com".into(),
                        name: None,
                        photo_url: None,
                    }]),
                    cc: None,
                    bcc: None,
                    body_text: lease.input.body_text.clone(),
                    body_html: None,
                    body_macro: None,
                    attachments: None,
                    headers_json: None,
                    send_time: None,
                },
                from: ContactInfo {
                    email: ADA.into(),
                    name: None,
                    photo_url: None,
                },
                parent_message_id: None,
                references: None,
            },
            files: Vec::new(),
            removals: Vec::new(),
        })
    }
    async fn draft_file_bytes(
        &self,
        _: &DraftLease,
        _: &DraftFile,
    ) -> Result<Vec<u8>, MailboxError> {
        unreachable!("no attachments")
    }
}

struct World {
    db: PgPool,
    emulator: OutlookEmulator,
    graph: Graph,
    sync: PgMailboxSync,
    repo: EmailPgRepo,
    service: MailboxDraftService<PgMailboxSync, Graph, Content>,
    input: ResolvedDraftInput,
    link: Uuid,
}

impl World {
    async fn new(db: PgPool) -> Self {
        let seed = Seed::parse(&format!("mailboxes:\n  - email: {ADA}\n")).unwrap();
        let emulator = OutlookEmulator::start(seed).await.unwrap();
        let url = MicrosoftGraphUrl::from(emulator.graph_url());
        let graph = Graph {
            api: Arc::new(MailboxApiService::new(
                OutlookApiClientRepository::for_graph_url(&url).unwrap(),
                Token(emulator.access_token(ADA).unwrap()),
                AlwaysAllowRateLimiter,
            )),
            before_read: Arc::default(),
            before_update: Arc::default(),
        };
        let (sync, repo, input, link) = setup(&db, false).await;
        let service = MailboxDraftService::new(sync.clone(), graph.clone(), Content);
        Self {
            db,
            emulator,
            graph,
            sync,
            repo,
            service,
            input,
            link,
        }
    }

    /// Runs the draft worker until it has nothing due, skipping its waits.
    async fn work(&self) {
        for _ in 0..20 {
            sqlx::query!("UPDATE email_mailbox_drafts SET available_at = now()")
                .execute(&self.db)
                .await
                .unwrap();
            if !self.service.execute_once().await.unwrap() {
                return;
            }
        }
        panic!("the draft worker never ran out of work");
    }

    async fn save(&mut self, body: &str, send: bool) {
        self.input.body_text = Some(body.into());
        self.input.send_time = send.then(chrono::Utc::now);
        self.input.draft_generation = sqlx::query_scalar!(
            "SELECT draft_generation FROM email_messages WHERE id = $1",
            self.input.db_id
        )
        .fetch_one(&self.db)
        .await
        .unwrap();
        self.repo
            .insert_message(
                &self.input,
                &UpsertedContacts {
                    from_contact_id: None,
                    recipients: Vec::new(),
                },
                self.link,
                None,
                !send,
            )
            .await
            .unwrap()
            .unwrap();
    }

    async fn state(&self) -> (String, Option<String>) {
        let row = sqlx::query!(
            "SELECT state, error_code FROM email_mailbox_drafts WHERE message_id = $1",
            self.input.db_id
        )
        .fetch_one(&self.db)
        .await
        .unwrap();
        (row.state, row.error_code)
    }

    fn draft(&self) -> outlook_emulator::MessageSummary {
        self.emulator.messages(ADA).unwrap().remove(0)
    }

    /// The mailbox changes the draft without touching its content.
    fn stamp(&self) {
        stamp(&self.emulator, &self.draft().id);
    }

    /// A person edits the draft in Outlook.
    fn edit(&self, body: &str) {
        let change = MessageChange {
            body: Some(body.into()),
            ..MessageChange::default()
        };
        self.emulator
            .update_message(ADA, &self.draft().id, &change)
            .unwrap();
    }

    /// Mailbox sync reads the draft back.
    async fn read_back(&self) {
        let work = self
            .sync
            .claim_message(Uuid::now_v7())
            .await
            .unwrap()
            .unwrap();
        let mailbox = MailboxKey {
            link_id: self.link,
            sync_generation: 1,
            grant_generation: 1,
        };
        let read = self
            .graph
            .api
            .message(access(mailbox), &work.provider_id, &self.folders().await)
            .await
            .unwrap()
            .unwrap();
        self.sync.ingest(&work, read).await.unwrap();
    }

    async fn folders(&self) -> Vec<MailFolder> {
        let mailbox = MailboxKey {
            link_id: self.link,
            sync_generation: 1,
            grant_generation: 1,
        };
        match self.graph.api.folders(access(mailbox)).await.unwrap() {
            MailFolderCatalog::Folders(folders) => folders,
            catalog => panic!("no folders: {catalog:?}"),
        }
    }

    async fn base_content(&self) -> Option<serde_json::Value> {
        sqlx::query_scalar!(
            "SELECT base_content FROM email_mailbox_drafts WHERE message_id = $1",
            self.input.db_id
        )
        .fetch_one(&self.db)
        .await
        .unwrap()
    }

    /// Graph requests that could change the mailbox.
    fn writes(&self) -> usize {
        self.emulator
            .requests()
            .iter()
            .filter(|request| request.method != "GET")
            .count()
    }
}

fn stamp(emulator: &OutlookEmulator, id: &str) {
    let change = MessageChange {
        categories: Some(vec!["Stamped".into()]),
        ..MessageChange::default()
    };
    emulator.update_message(ADA, id, &change).unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stamped_draft_still_sends(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    assert_eq!(world.state().await, ("synced".into(), None));
    world.stamp();
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
    assert!(!world.draft().is_draft);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_stamped_between_the_read_and_the_write_still_sends(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    let (emulator, id) = (world.emulator.clone(), world.draft().id);
    let mut stamps = 2;
    *world.graph.before_update.lock().unwrap() = Some(Box::new(move || {
        if stamps > 0 {
            stamps -= 1;
            stamp(&emulator, &id);
        }
    }));
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_stamped_before_every_read_still_sends(db: PgPool) {
    let mut world = World::new(db).await;
    let emulator = world.emulator.clone();
    *world.graph.before_read.lock().unwrap() = Some(Box::new(move || {
        if let Some(draft) = emulator
            .messages(ADA)
            .unwrap()
            .into_iter()
            .find(|message| message.is_draft)
        {
            stamp(&emulator, &draft.id);
        }
    }));
    world.work().await;
    assert_eq!(world.state().await, ("synced".into(), None));
    world.save("Second", false).await;
    world.work().await;
    assert_eq!(world.state().await, ("synced".into(), None));
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_stamped_again_after_sync_read_the_first_stamp_still_sends(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    let content = world.base_content().await.unwrap();
    world.stamp();
    world.read_back().await;
    let adopted = world.base_content().await.unwrap();
    assert_eq!(adopted["fingerprint"], content["fingerprint"]);
    assert_ne!(adopted["version"], content["version"]);
    world.stamp();
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_outlook_rewrote_before_sync_read_it_still_sends_when_stamped_again(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    let content = world.base_content().await;
    world.edit("Local  body\r\n");
    world.read_back().await;
    assert_ne!(world.base_content().await, content);
    world.stamp();
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_synced_before_baselines_gets_one_when_sync_reads_it(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    sqlx::query!("UPDATE email_mailbox_drafts SET base_content = NULL")
        .execute(&world.db)
        .await
        .unwrap();
    world.stamp();
    world.read_back().await;
    assert!(world.base_content().await.is_some());
    world.stamp();
    world.save("Ready to go", true).await;
    world.work().await;
    assert_eq!(world.state().await, ("sent".into(), None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edit_sync_read_is_the_new_baseline(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    world.edit("Edited in Outlook");
    world.read_back().await;

    // Macro edits on top of what sync read: known, so it is written.
    world.save("Edited after reading it", false).await;
    world.work().await;
    assert_eq!(world.state().await, ("synced".into(), None));

    // An edit nobody has read since is a conflict, as ever.
    world.edit("Edited in Outlook again");
    let writes = world.writes();
    world.save("Not read", false).await;
    world.work().await;
    let conflict = ("conflict".to_owned(), Some("draft_conflict".to_owned()));
    assert_eq!(world.state().await, conflict);
    assert_eq!(world.writes(), writes);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edit_in_outlook_is_neither_overwritten_nor_sent(db: PgPool) {
    let mut world = World::new(db).await;
    world.work().await;
    world.edit("Edited in Outlook");
    let writes = world.writes();
    world.save("First", true).await;
    world.work().await;
    let conflict = ("conflict".to_owned(), Some("draft_conflict".to_owned()));
    assert_eq!(world.state().await, conflict);

    // Cancelled and sent again: the conflict stays until the person chooses.
    sqlx::query!("DELETE FROM email_scheduled_messages")
        .execute(&world.db)
        .await
        .unwrap();
    sqlx::query!("UPDATE email_messages SET is_draft = true")
        .execute(&world.db)
        .await
        .unwrap();
    world.save("Second", true).await;
    world.work().await;
    assert_eq!(world.state().await, conflict);
    assert_eq!(world.writes(), writes);
    assert!(world.draft().is_draft);
}
