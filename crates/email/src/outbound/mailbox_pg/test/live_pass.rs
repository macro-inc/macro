//! A folder's import round never holds back its new mail: while the round
//! walks the folder, newest first, a live pass beside it lists only what
//! arrived since the round started.

use super::fixture;
use crate::domain::mailbox::live_pass::LiveImportPass;
use crate::domain::mailbox::*;
use crate::outbound::mailbox_pg::PgMailboxSync;
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::{
    EmailApiError, MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage, ProviderId,
    RoundStart, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Answers folder pages in order and records what each read asked for.
#[derive(Default)]
struct Folder {
    pages: Mutex<VecDeque<Result<MailboxChangePage, EmailApiError>>>,
    reads: Mutex<Vec<(Option<String>, RoundStart)>>,
}

impl Folder {
    fn answering(pages: Vec<Result<MailboxChangePage, EmailApiError>>) -> Arc<Self> {
        Arc::new(Self {
            pages: Mutex::new(pages.into()),
            ..Self::default()
        })
    }

    fn reads(&self) -> Vec<(Option<String>, RoundStart)> {
        self.reads.lock().unwrap().clone()
    }
}

impl MailboxGateway for Arc<Folder> {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        position: Option<&StreamToken>,
        start: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.reads
            .lock()
            .unwrap()
            .push((position.map(|position| position.expose().to_owned()), start));
        self.pages.lock().unwrap().pop_front().unwrap()
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        Ok(None)
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

fn page(ids: &[&str], position: StreamPosition) -> Result<MailboxChangePage, EmailApiError> {
    Ok(MailboxChangePage {
        changed: ids.iter().map(|id| ProviderId::new(*id).unwrap()).collect(),
        removed: Vec::new(),
        position,
        reader_revision: 1,
    })
}

fn next(token: &str) -> StreamPosition {
    StreamPosition::Continue(StreamToken::new(token.into()))
}

fn delta(token: &str) -> StreamPosition {
    StreamPosition::Checkpoint(StreamToken::new(token.into()))
}

/// The service with live reads from `live` and import reads from `import`.
fn service(
    repo: &PgMailboxSync,
    live: &Arc<Folder>,
    import: &Arc<Folder>,
    switch: bool,
) -> MailboxSyncService<PgMailboxSync, Arc<Folder>, PgMailboxSync> {
    let live_pass = LiveImportPass::default();
    live_pass.set(switch);
    MailboxSyncService::new(repo.clone(), live.clone(), import.clone(), repo.clone())
        .with_live_import_pass(live_pass)
}

struct LivePassRow {
    position: Option<String>,
    initial_complete: bool,
    received_since: chrono::DateTime<chrono::Utc>,
    due: bool,
}

async fn live_pass(db: &PgPool, link: Uuid) -> Option<LivePassRow> {
    sqlx::query!(
        r#"SELECT position, initial_complete, import_started_at AS "received_since!",
            next_run_at <= now() AS "due!"
        FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder_live' AND scope_id = 'folder'"#,
        link
    )
    .fetch_optional(db)
    .await
    .unwrap()
    .map(|row| LivePassRow {
        position: row.position,
        initial_complete: row.initial_complete,
        received_since: row.received_since,
        due: row.due,
    })
}

async fn queued(db: &PgPool, link: Uuid) -> Vec<(String, bool)> {
    sqlx::query!(
        "SELECT provider_id, is_import FROM email_message_reconciliation WHERE link_id = $1 ORDER BY provider_id",
        link
    )
    .fetch_all(db)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.provider_id, row.is_import))
    .collect()
}

async fn set_live_pass_due(db: &PgPool, link: Uuid, due: bool) {
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = CASE WHEN $2 THEN now() ELSE now() + interval '1 hour' END WHERE link_id = $1 AND kind = 'mail_folder_live'",
        link,
        due
    )
    .execute(db)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_round_reads_newest_first_and_opens_a_live_pass(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![page(&["old-1", "old-2"], next("page-2"))]);
    let service = service(&repo, &live, &import, true);
    let before = chrono::Utc::now();

    assert!(service.enumerate_once().await.unwrap());

    assert_eq!(import.reads(), vec![(None, RoundStart::NewestFirst)]);
    let opened = live_pass(&db, link).await.unwrap();
    assert!(opened.initial_complete, "its rows queue as live mail");
    assert_eq!(opened.position, None);
    assert!(opened.due);
    // It lists mail from when the round's first page was claimed.
    assert!(opened.received_since <= before + chrono::Duration::seconds(1));
    assert!(opened.received_since >= before - chrono::Duration::seconds(5));
    assert_eq!(
        queued(&db, link).await,
        vec![("old-1".into(), true), ("old-2".into(), true)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_the_switch_off_an_import_round_reads_as_before(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![
        page(&["old-1"], next("page-2")),
        page(&["old-2"], next("page-3")),
    ]);
    let service = service(&repo, &live, &import, false);

    assert!(service.enumerate_once().await.unwrap());
    assert!(live_pass(&db, link).await.is_none());

    // A live pass left from while the switch was on is not read.
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete) VALUES ($1,$2,1,'mail_folder_live','folder',true)",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.enumerate_once().await.unwrap());

    assert_eq!(
        import.reads(),
        vec![
            (None, RoundStart::Unordered),
            (Some("page-2".into()), RoundStart::Unordered),
        ]
    );
    assert!(live.reads().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_live_pass_is_read_first_through_the_live_reader_and_never_paced(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(vec![
        page(&["new-1"], delta("live-delta")),
        page(&["new-2"], delta("live-delta-2")),
    ]);
    let import = Folder::answering(vec![page(&["old-1"], next("page-2"))]);
    let service = service(&repo, &live, &import, true);
    assert!(service.enumerate_once().await.unwrap());
    let received_since = live_pass(&db, link).await.unwrap().received_since;

    // A test registering the span's callsite while ours was installed can
    // leave it uncaptured; by now it is registered.
    tracing::callsite::rebuild_interest_cache();

    // The folder's next page is due too; the live pass goes first.
    assert!(service.enumerate_once().await.unwrap());

    // It looks back five minutes before the round started.
    assert_eq!(
        live.reads(),
        vec![(
            None,
            RoundStart::ReceivedSince(received_since - chrono::Duration::minutes(5))
        )]
    );
    assert_eq!(import.reads().len(), 1);
    let read = live_pass(&db, link).await.unwrap();
    assert_eq!(read.position.as_deref(), Some("live-delta"));
    assert!(!read.due, "a checkpoint waits like a synced folder's");
    assert_eq!(
        queued(&db, link).await,
        vec![("new-1".into(), false), ("old-1".into(), true)]
    );
    let spans = telemetry.spans("outlook.sync.enumerate");
    assert_eq!(
        spans
            .last()
            .map(|span| span["outlook.stream_kind"].as_str()),
        Some("mail_folder_live")
    );

    // Two pages of import waiting hold the folder's walk, not new mail.
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import) SELECT $1,1,'queued-' || n,true FROM generate_series(1,300) n",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    set_live_pass_due(&db, link, true).await;
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(
        live.reads()[1],
        (
            Some("live-delta".into()),
            RoundStart::ReceivedSince(received_since - chrono::Duration::minutes(5))
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_rounds_checkpoint_retires_its_live_pass_and_completes_the_import(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at) VALUES ($1,$2,1,'folder_catalog','mail',true,now() + interval '1 hour')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![
        page(&[], next("page-2")),
        page(&[], delta("folder-delta")),
    ]);
    let service = service(&repo, &live, &import, true);
    assert!(service.enumerate_once().await.unwrap());
    assert!(live_pass(&db, link).await.is_some());
    set_live_pass_due(&db, link, false).await;

    assert!(service.enumerate_once().await.unwrap());

    assert!(live_pass(&db, link).await.is_none());
    let completed = telemetry.events("outlook import completed");
    let [(_, fields)] = completed.as_slice() else {
        panic!("expected one completion, got {completed:?}");
    };
    assert_eq!(fields["folders"], "1", "a live pass is not a folder");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_pass_opened_at_a_later_page_lists_mail_from_the_rounds_start(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![
        page(&["old-1"], next("page-2")),
        page(&["old-2"], next("page-3")),
    ]);
    // The round's first page is read with the switch off, so it opens no pass.
    let switch_off = service(&repo, &live, &import, false);
    assert!(switch_off.enumerate_once().await.unwrap());
    assert!(live_pass(&db, link).await.is_none());
    let round_started = sqlx::query_scalar!(
        r#"SELECT round_started_at AS "round_started_at!" FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();

    let switch_on = service(&repo, &live, &import, true);
    assert!(switch_on.enumerate_once().await.unwrap());

    assert_eq!(
        live_pass(&db, link).await.unwrap().received_since,
        round_started,
        "the pass covers the round from its first page, not from the page that opened it"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_folder_cursor_retires_its_live_pass(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![
        page(&["old-1"], next("page-2")),
        Err(EmailApiError::OutdatedCursor),
    ]);
    let service = service(&repo, &live, &import, true);
    assert!(service.enumerate_once().await.unwrap());
    set_live_pass_due(&db, link, false).await;

    assert!(service.enumerate_once().await.unwrap());

    assert!(live_pass(&db, link).await.is_none());
    let folder = sqlx::query!(
        "SELECT position, initial_complete FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder'",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(folder.position, None);
    assert!(!folder.initial_complete);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_live_pass_cursor_starts_it_over_without_requeueing_the_folder(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let live = Folder::answering(vec![Err(EmailApiError::OutdatedCursor)]);
    let import = Folder::answering(vec![page(&["old-1"], next("page-2"))]);
    let service = service(&repo, &live, &import, true);
    assert!(service.enumerate_once().await.unwrap());
    sqlx::query!(
        "UPDATE email_sync_streams SET position = 'live-delta', import_started_at = now() - interval '1 hour' WHERE link_id = $1 AND kind = 'mail_folder_live'",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let before = chrono::Utc::now();

    assert!(service.enumerate_once().await.unwrap());

    let restarted = live_pass(&db, link).await.unwrap();
    assert_eq!(restarted.position, None);
    assert!(restarted.initial_complete);
    assert!(restarted.due);
    assert!(restarted.received_since >= before - chrono::Duration::seconds(5));
    let folder = sqlx::query!(
        "SELECT position, initial_complete FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder'",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(folder.position.as_deref(), Some("page-2"));
    assert!(!folder.initial_complete);
    assert_eq!(queued(&db, link).await, vec![("old-1".into(), true)]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_removed_folder_takes_its_live_pass_with_it(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'folder_catalog','mail')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_folders (link_id,provider_id,display_name,role,catalog_generation) VALUES ($1,'folder','Projects','other',0)",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let live = Folder::answering(Vec::new());
    let import = Folder::answering(vec![page(&["old-1"], next("page-2"))]);
    let service = service(&repo, &live, &import, true);
    assert!(service.enumerate_once().await.unwrap());
    assert!(live_pass(&db, link).await.is_some());
    let catalog = repo
        .claim_catalog(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();

    repo.commit_catalog(&catalog, &[]).await.unwrap();

    let streams = sqlx::query_scalar!(
        "SELECT kind FROM email_sync_streams WHERE link_id = $1 ORDER BY kind",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(streams, ["folder_catalog"]);
}
