//! Wipes a database without losing the mutations it queued.
//!
//! The queue crosses in the side file kept beside the database: it is durable
//! there before the wipe and leaves once the next database holds it, so the
//! engine may die anywhere in between.

use super::{err_js, reset_required_js_error, storage_err_js};
use cache_turso::{
    QueueRead, SalvageFile, SalvagedQueue, TursoStorage, TursoStorageError, read_queue,
};
use turso_opfs::{OpenResult, OpfsError, OpfsErrorKind, OpfsOwner, Sidecar};
use wasm_bindgen::JsValue;

/// Reading a damaged database can end its worker, importing from one can fail
/// again and again. After this many tries the cache goes on without the queue.
const MAX_ATTEMPTS: u32 = 3;

/// What became of the mutations a wiped database queued.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum QueueOutcome {
    /// No database was wiped, or it queued nothing.
    #[default]
    None,
    /// Every one is queued in the new database under its own ID.
    Kept,
    /// Some are lost, or were queued again under new IDs.
    Partial,
    /// None of them could be read.
    Unreadable,
    /// They were given up: carrying them kept ending in a wipe, or the next
    /// database belongs to another account.
    Abandoned,
}

impl QueueOutcome {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Kept => "kept",
            Self::Partial => "partial",
            Self::Unreadable => "unreadable",
            Self::Abandoned => "abandoned",
        }
    }
}

/// How a queue crossed from a wiped database to the open one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct QueueReport {
    pub(super) outcome: QueueOutcome,
    /// Mutations queued in the open database that came from a wiped one.
    pub(super) kept: u64,
    /// Mutations known to be lost.
    pub(super) dropped: u64,
}

/// A wiped database's queue, until the next database holds it.
#[derive(Default)]
pub(super) struct Crossing {
    /// The queue itself only when the side file would not take it.
    unwritten: Option<SalvagedQueue>,
    report: QueueReport,
}

fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

/// Wipes `owner`'s database once what it queues is in the side file.
pub(super) async fn wipe_keeping_queue(
    scope: &str,
    owner: OpfsOwner,
) -> Result<(OpfsOwner, Crossing), JsValue> {
    let sidecar = owner.sidecar();
    let (owner, bytes) = or_busy(owner, sidecar.read().await).await?;
    let file = SalvageFile::decode(&bytes.unwrap_or_default());
    let (owner, read) = read_before_wipe(scope, owner, &sidecar, file).await?;
    let unwritten = match read.frame {
        Some(queue) => write_queue(&sidecar, read.end, queue).await,
        None => None,
    };
    let end = match unwritten {
        Some(_) => note_loss(&sidecar, read.end).await,
        None => read.end,
    };
    let owner = wipe(owner).await?;
    // A full disk has room again.
    let unwritten = match unwritten {
        Some(queue) => write_queue(&sidecar, end, queue).await,
        None => None,
    };
    Ok((
        owner,
        Crossing {
            unwritten,
            report: read.report,
        },
    ))
}

/// Returns the queue when the side file would not take it.
async fn write_queue(sidecar: &Sidecar, end: u64, queue: SalvagedQueue) -> Option<SalvagedQueue> {
    let written = sidecar.write_tail(end, &queue.to_frame()).await;
    written.is_err().then_some(queue)
}

/// Says that the database is wiped without a copy, for whoever comes next if
/// this worker dies before it is written. Returns where the next frame goes.
async fn note_loss(sidecar: &Sidecar, end: u64) -> u64 {
    let loss = SalvageFile::loss();
    match sidecar.write_tail(end, &loss).await {
        Ok(()) => end + loss.len() as u64,
        Err(_) => end,
    }
}

async fn wipe(owner: OpfsOwner) -> Result<OpfsOwner, JsValue> {
    owner
        .recovery_wipe()
        .await
        .map_err(|failure| storage_err_js(failure.error()))
}

/// Rejects, releasing the lock, when another context keeps the side file open:
/// it is closing it, and the next attempt reads it.
async fn or_busy<T>(
    owner: OpfsOwner,
    result: Result<T, OpfsError>,
) -> Result<(OpfsOwner, Option<T>), JsValue> {
    match result {
        Ok(value) => Ok((owner, Some(value))),
        Err(error) if error.kind() == OpfsErrorKind::Busy => {
            owner.release().await.map_err(err_js)?;
            Err(storage_err_js(&error))
        }
        // Whatever else is wrong with the side file never stops the cache.
        Err(_) => Ok((owner, None)),
    }
}

struct ReadBeforeWipe {
    /// A queue the side file does not hold yet, and where it goes.
    frame: Option<SalvagedQueue>,
    end: u64,
    report: QueueReport,
}

impl ReadBeforeWipe {
    /// Nothing of the database could be read. A queue the side file holds from
    /// before is not all there was, and says so to whoever imports it.
    fn unreadable(mut self, file: SalvageFile) -> Self {
        self.report.outcome = QueueOutcome::Unreadable;
        let pending = file.into_queue();
        self.frame = pending
            .clone()
            .map(SalvagedQueue::after_loss)
            .filter(|queue| Some(queue) != pending.as_ref());
        self
    }
}

async fn read_before_wipe(
    scope: &str,
    owner: OpfsOwner,
    sidecar: &Sidecar,
    file: SalvageFile,
) -> Result<(OpfsOwner, ReadBeforeWipe), JsValue> {
    let mut read = ReadBeforeWipe {
        frame: None,
        end: file.end(),
        report: QueueReport::default(),
    };
    if file.reads() >= MAX_ATTEMPTS {
        return Ok((owner, read.unreadable(file)));
    }
    let attempt = SalvageFile::read_attempt();
    let start = file.end();
    if sidecar.write_tail(start, &attempt).await.is_ok() {
        read.end += attempt.len() as u64;
    }
    let session = match owner.open().await {
        Ok(OpenResult::Ready(session)) => session,
        // One file of the pair alone is a wipe or a creation cut short.
        Ok(OpenResult::ResetRequired(session)) => {
            let owner = session
                .reset()
                .await
                .map_err(|failure| storage_err_js(failure.error()))?;
            return Ok((owner, read));
        }
        Err(failure) => {
            let busy = failure.error().kind() == OpfsErrorKind::Busy;
            let error = storage_err_js(failure.error());
            let Some(owner) = failure.into_owner() else {
                return Err(error);
            };
            if busy {
                // Nothing was read, so this attempt does not count.
                let _ = sidecar.write_tail(start, &[]).await;
                owner.release().await.map_err(err_js)?;
                return Err(error);
            }
            return Ok((owner, read.unreadable(file)));
        }
    };
    let connected = match session.connect() {
        Ok(connected) => connected,
        Err(failure) => {
            // Only another worker can wipe now, and it would fail the same way.
            let skip = SalvageFile::read_attempt().repeat(MAX_ATTEMPTS as usize);
            let _ = sidecar.write_tail(read.end, &skip).await;
            return Err(err_js(failure));
        }
    };
    let reads = file.reads() as usize + 1;
    let pending = file.into_queue();
    let found = read_queue(&connected, scope, pending.clone(), now_ms());
    read.report = report_of(&found);
    if found.forget_pending {
        let attempts = attempt.repeat(reads);
        read.end = attempts.len() as u64;
        // What the database holds and may have settled must not come back.
        if sidecar.write_tail(0, &attempts).await.is_err() {
            sidecar.remove().await.map_err(err_js)?;
            read.end = 0;
        }
    }
    read.frame = found.queue.filter(|queue| Some(queue) != pending.as_ref());
    if let Some(queue) = &read.frame {
        let frame = queue.to_frame();
        if sidecar.write_tail(read.end, &frame).await.is_ok() {
            read.frame = None;
        }
    }
    let owner = connected
        .try_close()
        .map_err(err_js)?
        .preserve()
        .map_err(err_js)?;
    Ok((owner, read))
}

fn storage_error(error: TursoStorageError) -> JsValue {
    if error.requires_physical_reset() {
        reset_required_js_error()
    } else {
        err_js(error)
    }
}

fn report_of(found: &QueueRead) -> QueueReport {
    let lost = found.dropped > 0 || !found.complete;
    QueueReport {
        outcome: match (found.abandoned, &found.queue) {
            (true, _) => QueueOutcome::Abandoned,
            (false, None) if lost => QueueOutcome::Unreadable,
            (false, _) => QueueOutcome::None,
        },
        kept: 0,
        dropped: found.dropped,
    }
}

impl Crossing {
    /// What this wipe and a later one found.
    pub(super) fn then(self, later: Self) -> Self {
        Self {
            unwritten: later.unwritten.or(self.unwritten),
            report: QueueReport {
                outcome: match later.report.outcome {
                    QueueOutcome::None => self.report.outcome,
                    outcome => outcome,
                },
                kept: 0,
                dropped: self.report.dropped + later.report.dropped,
            },
        }
    }

    /// Queues what crossed in `storage`, which nothing else has used yet.
    pub(super) async fn finish(
        self,
        sidecar: &Sidecar,
        storage: &mut TursoStorage,
    ) -> Result<QueueReport, JsValue> {
        let mut report = self.report;
        let bytes = match sidecar.read().await {
            Ok(bytes) => bytes,
            // Serving first would let newer writes overtake the ones in it.
            Err(error) if error.kind() == OpfsErrorKind::Busy => {
                return Err(storage_err_js(&error));
            }
            Err(_) => Vec::new(),
        };
        if bytes.is_empty() && self.unwritten.is_none() {
            return Ok(report);
        }
        let file = SalvageFile::decode(&bytes);
        let (end, lost) = (file.end(), file.lost());
        let imports = match self.unwritten {
            Some(_) => 0,
            None => file.imports(),
        };
        let Some(queue) = self.unwritten.or(file.into_queue()) else {
            if lost && report.outcome == QueueOutcome::None {
                report.outcome = QueueOutcome::Unreadable;
            }
            remove(sidecar).await?;
            return Ok(report);
        };
        if imports >= MAX_ATTEMPTS {
            report.outcome = QueueOutcome::Abandoned;
            report.dropped += queue.len();
            remove(sidecar).await?;
            return Ok(report);
        }
        let attempt = SalvageFile::import_attempt();
        unless_busy(sidecar.write_tail(end, &attempt).await)?;
        let imported = storage
            .import_queue(&queue, now_ms())
            .map_err(storage_error)?;
        report.kept = imported.kept;
        report.dropped += imported.dropped;
        let whole = imported.complete && report.outcome == QueueOutcome::None;
        report.outcome = match (whole, imported.kept, imported.dropped) {
            (true, 1.., _) => QueueOutcome::Kept,
            (false, 1.., _) => QueueOutcome::Partial,
            (_, 0, 1..) => QueueOutcome::Abandoned,
            // Held already: whoever imported it may not have told.
            (_, 0, 0) if !imported.complete && report.outcome == QueueOutcome::None => {
                QueueOutcome::Partial
            }
            (_, 0, 0) => report.outcome,
        };
        // The database names the queue it holds, so a copy that stays for any
        // other reason is inert while the database can be read.
        remove(sidecar).await?;
        Ok(report)
    }
}

/// Rejects when another context keeps the side file open, which passes: the
/// next attempt goes on from here. Whatever else is wrong with the side file
/// never stops the cache.
fn unless_busy(result: Result<(), OpfsError>) -> Result<(), JsValue> {
    match result {
        Err(error) if error.kind() == OpfsErrorKind::Busy => Err(storage_err_js(&error)),
        _ => Ok(()),
    }
}

async fn remove(sidecar: &Sidecar) -> Result<(), JsValue> {
    unless_busy(sidecar.remove().await)
}

/// Forgets a queue on its way, with the database it was on its way to. One
/// that stays could reach the next account, so a failure is the caller's.
pub(super) async fn forget(sidecar: &Sidecar) -> Result<(), JsValue> {
    sidecar
        .remove()
        .await
        .map_err(|error| storage_err_js(&error))
}

/// How many mutations are on their way to this identity's next database.
pub(super) async fn pending(owner: &OpfsOwner) -> Result<u64, OpfsError> {
    let file = SalvageFile::decode(&owner.sidecar().read().await?);
    Ok(file.queue().map_or(0, SalvagedQueue::len))
}
