//! Poll durable mailbox work. Notifications only change when that work is due.

use email::domain::mailbox::{
    MailboxError, MailboxGateway, MailboxIngest, MailboxSyncRepository, MailboxSyncService,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Domain services own sync and retry decisions; this loop only schedules work
/// and stops accepting work during shutdown. Interrupted work retains its lease.
pub async fn run<R: MailboxSyncRepository, P: MailboxGateway, I: MailboxIngest>(
    service: MailboxSyncService<R, P, I>,
    cancellation: CancellationToken,
) {
    loop {
        let cycle = async {
            let mut worked = record(service.discover_once().await);
            worked |= record(service.enumerate_once().await);
            for _ in 0..32 {
                if !record(service.reconcile_once().await) {
                    break;
                }
                worked = true;
            }
            worked
        };
        let worked = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            worked = cycle => worked,
        };
        if !worked {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    }
}

fn record(result: Result<bool, MailboxError>) -> bool {
    match result {
        Ok(worked) => worked,
        Err(MailboxError::Stale) => false,
        Err(error) => {
            tracing::warn!(%error,"mailbox sync work deferred");
            false
        }
    }
}

pub async fn run_lifecycle<R, E>(
    service: email::domain::mailbox::lifecycle::InboxLifecycleService<R, E>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::lifecycle::InboxLifecycleRepository,
    E: email::domain::mailbox::lifecycle::InboxLifecycleEffects,
{
    use futures::{StreamExt, stream};
    loop {
        let cycle = async {
            let mut claims = stream::iter(0..4)
                .map(|_| service.publish_once())
                .buffer_unordered(4);
            let mut worked = false;
            while let Some(result) = claims.next().await {
                worked |= record(result);
            }
            worked
        };
        let worked =
            tokio::select! {biased;_ = cancellation.cancelled()=>return,worked=cycle=>worked};
        if !worked {
            tokio::select! {biased;_ = cancellation.cancelled()=>return,_ = tokio::time::sleep(Duration::from_secs(1))=>{}}
        }
    }
}

pub async fn run_contacts<R, G, S>(
    service: email::domain::mailbox::contacts::AddressBookService<R, G, S>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::contacts::AddressBookRepository,
    G: email::domain::mailbox::contacts::AddressBookGateway,
    S: email::domain::mailbox::contacts::ContactPhotoStorage,
{
    loop {
        let cycle = async {
            let mut worked = record(service.sync_once().await);
            for _ in 0..8 {
                if !record(service.photo_once().await) {
                    break;
                }
                worked = true;
            }
            worked
        };
        let worked = tokio::select! { biased; _ = cancellation.cancelled() => return, worked = cycle => worked };
        if !worked {
            tokio::select! { biased; _ = cancellation.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(5)) => {} }
        }
    }
}

/// Draft synchronization and sends run independently of bulk mailbox imports.
pub async fn run_drafts<R, G, M>(
    service: email::domain::mailbox::drafts::MailboxDraftService<R, G, M>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::drafts::ports::DraftRepository,
    G: email::domain::mailbox::drafts::ports::DraftGateway,
    M: email::domain::mailbox::drafts::ports::DraftMaterializer,
{
    loop {
        let worked = tokio::select! { biased; _ = cancellation.cancelled() => return, result = service.execute_once() => record(result) };
        if !worked {
            tokio::select! { biased; _ = cancellation.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(1)) => {} }
        }
    }
}

/// Run downstream projections independently so slow uploads do not hold sync pages.
pub async fn run_projections<R, E>(
    service: email::domain::mailbox::projection::MailboxProjectionService<R, E>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::projection::MailboxProjectionRepository,
    E: email::domain::mailbox::projection::MailboxProjectionEffects,
{
    loop {
        let worked = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = service.project_once() => record(result),
        };
        if !worked {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    }
}

/// Commands have their own scheduling loop so imports cannot starve user actions.
pub async fn run_commands<R, G>(
    service: email::domain::mailbox::commands::MailboxCommandService<R, G>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::commands::MailboxCommandRepository,
    G: email::domain::mailbox::commands::MailboxCommandGateway,
{
    loop {
        let worked = tokio::select! { biased; _ = cancellation.cancelled() => return, result = service.execute_once() => record(result) };
        if !worked {
            tokio::select! { biased; _ = cancellation.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(1)) => {} }
        }
    }
}

/// S3 deletions are safe to repeat; failed work retains its expiring claim.
pub async fn run_attachment_cleanup<R, S>(
    service: email::domain::attachment_cleanup::DraftObjectCleanup<R, S>,
    cancellation: CancellationToken,
) where
    R: email::domain::attachment_cleanup::DraftObjectCleanupRepository,
    S: email::domain::attachment_cleanup::DraftObjectDeletion,
{
    loop {
        let result = tokio::select! {biased;_ = cancellation.cancelled()=>return,result=service.execute_once()=>result};
        let worked = match result {
            Ok(worked) => worked,
            Err(error) => {
                tracing::warn!(%error,"draft attachment cleanup deferred");
                false
            }
        };
        if !worked {
            tokio::select! {biased;_ = cancellation.cancelled()=>return,_ = tokio::time::sleep(Duration::from_secs(30))=>{}}
        }
    }
}

pub async fn run_settings<R, G>(
    service: email::domain::mailbox::settings::MailboxSettingsService<R, G>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::settings::MailboxSettingsRepository,
    G: email::domain::mailbox::settings::MailboxSettingsGateway,
{
    loop {
        let worked = tokio::select! {biased;_ = cancellation.cancelled()=>return,result=service.execute_once()=>record(result)};
        if !worked {
            tokio::select! {biased;_ = cancellation.cancelled()=>return,_ = tokio::time::sleep(Duration::from_secs(1))=>{}}
        }
    }
}

pub async fn run_watches<R, G>(
    service: email::domain::mailbox::watches::MailboxWatchService<R, G>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::watches::MailboxWatchRepository,
    G: email::domain::mailbox::watches::MailboxWatchGateway,
{
    loop {
        let worked = tokio::select! {biased;_ = cancellation.cancelled()=>return,result=service.execute_once()=>record(result)};
        if !worked {
            tokio::select! {biased;_ = cancellation.cancelled()=>return,_ = tokio::time::sleep(Duration::from_secs(5))=>{}}
        }
    }
}

/// Resolve the retired delivery identity independently of destination saves.
pub async fn run_transfers<R, G>(
    service: email::domain::draft_transfer::DraftRetirementService<R, G>,
    cancellation: CancellationToken,
) where
    R: email::domain::draft_transfer::DraftTransferRepository,
    G: email::domain::draft_transfer::DraftRetirementGateway,
{
    loop {
        let worked = tokio::select! {biased;_ = cancellation.cancelled()=>return,result=service.execute_once()=>record(result)};
        if !worked {
            tokio::select! {biased;_ = cancellation.cancelled()=>return,_ = tokio::time::sleep(Duration::from_secs(1))=>{}}
        }
    }
}
