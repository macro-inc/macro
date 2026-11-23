use super::*;
use email::domain::mailbox::MailboxKey;
use email::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::domain::models::{
    MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage, ProviderId, RoundStart,
    StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use uuid::Uuid;

struct RecoveryBudget {
    limits: Arc<Mutex<Vec<u32>>>,
    cancellation: CancellationToken,
}

impl email::domain::mailbox::parked_work_recovery::ParkedWorkRecoveryRepository for RecoveryBudget {
    async fn recover_page(
        &self,
        limit: u32,
    ) -> Result<
        Option<email::domain::mailbox::parked_work_recovery::ParkedWorkRecoveryPage>,
        MailboxError,
    > {
        let count = {
            let mut limits = self.limits.lock().unwrap();
            limits.push(limit);
            limits.len()
        };
        if count <= 6 {
            return Err(MailboxError::Persistence);
        }
        if count == 13 {
            self.cancellation.cancel();
        }
        Ok(Some(
            email::domain::mailbox::parked_work_recovery::ParkedWorkRecoveryPage {
                links_scanned: limit,
                rows_unparked: 0,
                failed_probes: 0,
                complete: false,
            },
        ))
    }
}

#[tokio::test(start_paused = true)]
async fn parked_work_recovery_restores_its_budget_and_stops_during_progress() {
    let cancellation = CancellationToken::new();
    let limits = Arc::new(Mutex::new(Vec::new()));
    let service =
        email::domain::mailbox::parked_work_recovery::ParkedWorkRecoveryService(RecoveryBudget {
            limits: limits.clone(),
            cancellation: cancellation.clone(),
        });
    let before = tokio::time::Instant::now();
    run_parked_work_recovery(service, cancellation).await;
    assert_eq!(
        *limits.lock().unwrap(),
        vec![64, 32, 16, 8, 4, 2, 1, 2, 4, 8, 16, 32, 64]
    );
    assert_eq!(
        before.elapsed(),
        Duration::from_secs(30),
        "only failed pages sleep; Progress must re-poll immediately"
    );
}

/// Logs every read. An importing folder always has another page; the synced
/// folder's page reaches a checkpoint, and no message is found.
#[derive(Clone, Default)]
struct Provider {
    reads: Arc<Mutex<Vec<String>>>,
    synced_read: Arc<Notify>,
}

impl MailboxGateway for Provider {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        folder: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.reads.lock().unwrap().push(folder.as_str().to_owned());
        let position = if folder.as_str() == "importing" {
            StreamPosition::Continue(StreamToken::new("next-page".into()))
        } else {
            self.synced_read.notify_one();
            StreamPosition::Checkpoint(StreamToken::new("checkpoint".into()))
        };
        Ok(MailboxChangePage {
            changed: Vec::new(),
            removed: Vec::new(),
            position,
            reader_revision: 1,
        })
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        self.reads.lock().unwrap().push("message".into());
        Ok(None)
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

async fn mailbox(db: &PgPool, folder: &str, synced: bool, due: &str) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,$2,'outlook-owner',$3,'OUTLOOK',1)
    "#,
        link,
        format!("macro|{link}@example.com"),
        format!("{link}@example.com")
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,position,initial_complete,next_run_at)
        VALUES ($1,$2,1,'mail_folder',$3,$4,$5,now() - $6::text::interval)
    "#,
        macro_uuid::generate_uuid_v7(),
        link,
        folder,
        synced.then_some("checkpoint"),
        synced,
        due
    )
    .execute(db)
    .await
    .unwrap();
    link
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_mail_in_a_synced_folder_waits_behind_one_queued_import_message_not_a_cycle(
    db: PgPool,
) {
    let importing = mailbox(&db, "importing", false, "7 minutes").await;
    // Due after the importing folder's first page and before its next one,
    // which is claimed as if due five minutes earlier than it is.
    mailbox(&db, "synced", true, "6 minutes").await;
    // Each queued message is read once more and then recorded as gone.
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,attempts)
        SELECT $1,1,'queued-' || n,true,3 FROM generate_series(1,40) n
    "#,
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    let repo = PgMailboxSync::new(db.clone());
    let provider = Provider::default();
    let service = MailboxSyncService::new(repo.clone(), provider.clone(), provider.clone(), repo);
    let cancellation = CancellationToken::new();
    let worker = tokio::spawn(run(service, cancellation.clone()));

    tokio::time::timeout(Duration::from_secs(30), provider.synced_read.notified())
        .await
        .expect("the synced folder's page is read");
    cancellation.cancel();
    worker.await.unwrap();

    let reads = provider.reads.lock().unwrap().clone();
    let before_synced: Vec<_> = reads.iter().take_while(|read| *read != "synced").collect();
    assert_eq!(before_synced, ["importing", "message"], "{reads:?}");
}

struct ProgressOnly {
    calls: Arc<std::sync::atomic::AtomicUsize>,
    cancel_at: usize,
    cancellation: CancellationToken,
}

impl email::domain::mailbox::projection::MailboxProjectionRepository for ProgressOnly {
    async fn claim_projection(
        &self,
        _: Uuid,
    ) -> Result<email::domain::mailbox::projection::ProjectionClaim, MailboxError> {
        let calls = self
            .calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        if calls == self.cancel_at {
            self.cancellation.cancel();
        }
        Ok(email::domain::mailbox::projection::ProjectionClaim::Progress)
    }
    async fn renew_projection(
        &self,
        _: &email::domain::mailbox::projection::ProjectionLease,
    ) -> Result<(), MailboxError> {
        panic!("progress must not renew a projection lease")
    }
    async fn projection_context(
        &self,
        _: &email::domain::mailbox::projection::ProjectionLease,
    ) -> Result<Option<email::domain::mailbox::projection::ProjectionContext>, MailboxError> {
        panic!("progress must not read a projection context")
    }
    async fn finish_projection(
        &self,
        _: &email::domain::mailbox::projection::ProjectionLease,
        _: Option<email::domain::mailbox::MessageRetry>,
    ) -> Result<(), MailboxError> {
        panic!("progress must not finish a projection lease")
    }
}

struct NoProjectionEffects;
impl email::domain::mailbox::projection::MailboxProjectionEffects for NoProjectionEffects {
    async fn publish(&self, _: email::domain::events::EmailMacroEvent) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn refresh(
        &self,
        _: Uuid,
        _: &std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn import_completed(
        &self,
        _: Uuid,
        _: &std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn notify(
        &self,
        _: email::domain::mailbox::projection::MailboxNotification,
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn contacts(
        &self,
        _: email::domain::mailbox::projection::CorrespondenceProjection,
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn attachments(
        &self,
        _: MailboxKey,
        _: &email::domain::mailbox::projection::ProjectionContext,
        _: bool,
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
    async fn invitations(
        &self,
        _: Uuid,
        _: &[email::domain::models::calendar_invitation::CalendarInvitation],
    ) -> Result<(), MailboxError> {
        panic!("progress must not emit effects")
    }
}

#[tokio::test(start_paused = true)]
async fn projection_progress_repolls_without_idle_sleep_and_honors_cancellation() {
    for cancel_at in [3, 67] {
        let cancellation = CancellationToken::new();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let service = email::domain::mailbox::projection::MailboxProjectionService::new(
            ProgressOnly {
                calls: calls.clone(),
                cancel_at,
                cancellation: cancellation.clone(),
            },
            NoProjectionEffects,
        );
        let started = tokio::time::Instant::now();
        tokio::time::timeout(
            Duration::from_secs(1),
            run_projections(service, cancellation),
        )
        .await
        .expect("progress polling must remain cancellable without idle sleeps");
        assert_eq!(started.elapsed(), Duration::ZERO);
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), cancel_at);
    }
}
