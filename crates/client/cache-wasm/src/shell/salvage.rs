//! Wipes a database without losing the mutations it queued.
//!
//! The queue crosses in the side file kept beside the database: it is durable
//! there before the wipe and leaves once the next database holds it, so the
//! engine may die anywhere in between.

use super::{err_js, reset_required_js_error, storage_err_js};
use crate::query_telemetry;
use cache_turso::{
    QueueLoss, QueueRead, SalvageFile, SalvagedQueue, TursoStorage, TursoStorageError, read_queue,
};
use turso_opfs::{OpenResult, OpfsError, OpfsErrorKind, OpfsOwner, Sidecar};
use wasm_bindgen::JsValue;

/// Reading a damaged database can end its worker, importing from one can fail
/// again and again. After this many tries the cache goes on without the queue.
const MAX_ATTEMPTS: u32 = 3;
/// Tries to read a side file that fails, which nothing else explains.
const FILE_READS: u32 = 3;

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
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct QueueReport {
    pub(super) outcome: QueueOutcome,
    /// Mutations queued in the open database that came from a wiped one.
    pub(super) kept: u64,
    /// Mutations known to be lost.
    pub(super) dropped: u64,
    pub(super) times: CrossingTimes,
}

/// How long each step of a crossing took, for those it had.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct CrossingTimes {
    /// Until the queue of the old database was durable in the side file.
    pub(super) read_ms: Option<f64>,
    pub(super) wipe_ms: Option<f64>,
    pub(super) import_ms: Option<f64>,
}

impl CrossingTimes {
    /// These and the ones of a later crossing, added up.
    fn then(self, later: Self) -> Self {
        let sum = |first: Option<f64>, second: Option<f64>| match (first, second) {
            (Some(first), Some(second)) => Some(first + second),
            _ => first.or(second),
        };
        Self {
            read_ms: sum(self.read_ms, later.read_ms),
            wipe_ms: sum(self.wipe_ms, later.wipe_ms),
            import_ms: sum(self.import_ms, later.import_ms),
        }
    }
}

/// A wiped database's queue, until the next database holds it.
#[derive(Default)]
pub(super) struct Crossing {
    /// The queue itself, for when the side file does not give it back.
    queue: Option<SalvagedQueue>,
    /// Whether the side file would not take it.
    unwritten: bool,
    /// Less what the side file tells.
    report: QueueReport,
    /// Whether one file of the database was gone, and with it whether that
    /// database had taken the queue.
    torn: bool,
}

fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

/// Wipes `owner`'s database once what it queues is in the side file.
pub(super) async fn wipe_keeping_queue(
    scope: &str,
    owner: OpfsOwner,
) -> Result<(OpfsOwner, Crossing), JsValue> {
    let started = query_telemetry::now_ms();
    let sidecar = owner.sidecar();
    let (owner, file) = or_release(owner, read_file(&sidecar).await).await?;
    let unread = file.is_none();
    let (owner, mut read) =
        read_before_wipe(scope, owner, &sidecar, file.unwrap_or_default()).await?;
    if unread {
        read.report.lose();
    }
    read.write_queue(&sidecar).await;
    let queue = read.queue.take().map(|queue| match unread {
        true => queue.after_loss(),
        false => queue,
    });
    let mut unwritten = read.unwritten;
    if unwritten || read.report.lost() {
        let loss = QueueLoss {
            abandoned: read.report.outcome == QueueOutcome::Abandoned,
            dropped: read.report.dropped,
        };
        let frame = SalvageFile::loss(loss);
        if sidecar.write_tail(read.end, &frame).await.is_ok() {
            read.end += frame.len() as u64;
            read.report.dropped = 0;
        }
    }
    let wiping = query_telemetry::now_ms();
    let owner = wipe(owner).await?;
    read.report.times = CrossingTimes {
        read_ms: Some(wiping - started),
        wipe_ms: Some(query_telemetry::now_ms() - wiping),
        import_ms: None,
    };
    // A full disk has room again.
    if let (true, Some(queue)) = (unwritten, &queue) {
        unwritten = write_queue(&sidecar, read.end, queue).await.is_none();
    }
    Ok((
        owner,
        Crossing {
            queue,
            unwritten,
            report: read.report,
            torn: read.torn,
        },
    ))
}

/// Notes that the copy in `file` may be held by a database about to be reset
/// for want of one of its files: a later engine would find only its successor.
/// Returns how much longer the side file is.
async fn doubt(sidecar: &Sidecar, end: u64, file: &SalvageFile) -> u64 {
    if file.imports() == 0 {
        return 0;
    }
    let frame = SalvageFile::loss(QueueLoss::default());
    match sidecar.write_tail(end, &frame).await {
        Ok(()) => frame.len() as u64,
        Err(_) => 0,
    }
}

/// [`doubt`], for an engine that wipes nothing else.
pub(super) async fn doubt_copy(sidecar: &Sidecar) -> Result<(), JsValue> {
    let read = read_file(sidecar).await;
    if let Some(file) = read.map_err(|error| storage_err_js(&error))? {
        doubt(sidecar, file.end(), &file).await;
    }
    Ok(())
}

/// The side file, or nothing when it cannot be read. A failure that passes
/// must not cost the queue in it.
async fn read_file(sidecar: &Sidecar) -> Result<Option<SalvageFile>, OpfsError> {
    for _ in 0..FILE_READS {
        match sidecar.read().await {
            Ok(bytes) => return Ok(Some(SalvageFile::decode(&bytes))),
            Err(error) if error.kind() == OpfsErrorKind::Busy => return Err(error),
            Err(_) => {}
        }
    }
    Ok(None)
}

async fn wipe(owner: OpfsOwner) -> Result<OpfsOwner, JsValue> {
    owner
        .recovery_wipe()
        .await
        .map_err(|failure| storage_err_js(failure.error()))
}

/// Rejects, releasing the lock, when the side file failed the caller. Another
/// context that keeps it open is closing it, and the next attempt goes on.
async fn or_release<T>(
    owner: OpfsOwner,
    result: Result<T, OpfsError>,
) -> Result<(OpfsOwner, T), JsValue> {
    match result {
        Ok(value) => Ok((owner, value)),
        Err(error) => {
            owner.release().await.map_err(err_js)?;
            Err(storage_err_js(&error))
        }
    }
}

/// Writes `queue` with room for what a later wipe may have to say after it, or
/// without. Returns where its frame ends.
async fn write_queue(sidecar: &Sidecar, end: u64, queue: &SalvagedQueue) -> Option<u64> {
    let frame = queue.to_frame();
    let reserved = [&frame[..], &SalvageFile::reserved_for_wipe()].concat();
    let written = sidecar.write_tail(end, &reserved).await.is_ok()
        || sidecar.write_tail(end, &frame).await.is_ok();
    written.then_some(frame.len() as u64)
}

struct ReadBeforeWipe {
    /// A queue that is new to the side file.
    queue: Option<SalvagedQueue>,
    /// Whether the side file does not hold it yet.
    unwritten: bool,
    /// Where the side file goes on.
    end: u64,
    report: QueueReport,
    torn: bool,
}

impl ReadBeforeWipe {
    /// Nothing of the database could be read. A queue the side file holds from
    /// before is not all there was, and says so to whoever imports it.
    fn unreadable(mut self, file: SalvageFile) -> Self {
        self.report.lose();
        let pending = file.into_queue();
        let doubted = pending.clone().map(SalvagedQueue::after_loss);
        self.carry(doubted, pending);
        self
    }

    /// Carries `queue`, when it is not the one the side file holds.
    fn carry(&mut self, queue: Option<SalvagedQueue>, held: Option<SalvagedQueue>) {
        self.queue = queue.filter(|queue| Some(queue) != held.as_ref());
        self.unwritten = self.queue.is_some();
    }

    /// Keeps it unwritten when the side file would not take it.
    async fn write_queue(&mut self, sidecar: &Sidecar) {
        let Some(queue) = self.queue.as_ref().filter(|_| self.unwritten) else {
            return;
        };
        if let Some(written) = write_queue(sidecar, self.end, queue).await {
            self.end += written;
            self.unwritten = false;
        }
    }
}

async fn read_before_wipe(
    scope: &str,
    owner: OpfsOwner,
    sidecar: &Sidecar,
    file: SalvageFile,
) -> Result<(OpfsOwner, ReadBeforeWipe), JsValue> {
    let mut read = ReadBeforeWipe {
        queue: None,
        unwritten: false,
        end: file.end(),
        report: QueueReport::default(),
        torn: false,
    };
    if file.reads() >= MAX_ATTEMPTS {
        return Ok((owner, read.unreadable(file)));
    }
    let attempt = SalvageFile::read_attempt();
    let start = file.end();
    let reserved = [&attempt[..], &SalvageFile::reserved()].concat();
    if sidecar.write_tail(start, &reserved).await.is_ok()
        || sidecar.write_tail(start, &attempt).await.is_ok()
    {
        read.end += attempt.len() as u64;
    }
    let session = match owner.open().await {
        Ok(OpenResult::Ready(session)) => session,
        // One file of the pair alone is a wipe or a creation cut short.
        Ok(OpenResult::ResetRequired(session)) => {
            read.end += doubt(sidecar, read.end, &file).await;
            let owner = session
                .reset()
                .await
                .map_err(|failure| storage_err_js(failure.error()))?;
            read.torn = true;
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
    let forgotten = if found.forget_pending {
        let attempts = attempt.repeat(reads);
        read.end = attempts.len() as u64;
        // What the database holds and may have settled must not come back.
        match sidecar.write_tail(0, &attempts).await {
            Ok(()) => Ok(()),
            Err(_) => {
                read.end = 0;
                sidecar.remove().await
            }
        }
    } else {
        Ok(())
    };
    if forgotten.is_ok() {
        read.carry(found.queue, pending);
        read.write_queue(sidecar).await;
    }
    let owner = connected
        .try_close()
        .map_err(err_js)?
        .preserve()
        .map_err(err_js)?;
    let (owner, ()) = or_release(owner, forgotten).await?;
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
        times: CrossingTimes::default(),
    }
}

impl QueueReport {
    fn lost(&self) -> bool {
        self.outcome != QueueOutcome::None || self.dropped > 0
    }

    /// Writes were lost, nobody knows how many.
    fn lose(&mut self) {
        if self.outcome == QueueOutcome::None {
            self.outcome = QueueOutcome::Unreadable;
        }
    }
}

impl Crossing {
    /// This crossing, to a database whose other half was gone.
    pub(super) fn torn(self) -> Self {
        Self { torn: true, ..self }
    }

    /// What this wipe and a later one found.
    pub(super) fn then(self, later: Self) -> Self {
        Self {
            torn: self.torn || later.torn,
            unwritten: match later.queue {
                Some(_) => later.unwritten,
                None => self.unwritten,
            },
            queue: later.queue.or(self.queue),
            report: QueueReport {
                outcome: match later.report.outcome {
                    QueueOutcome::None => self.report.outcome,
                    outcome => outcome,
                },
                kept: 0,
                dropped: self.report.dropped + later.report.dropped,
                times: self.report.times.then(later.report.times),
            },
        }
    }

    /// Queues what crossed in `storage`, which nothing else has used yet.
    pub(super) async fn finish(
        self,
        sidecar: &Sidecar,
        storage: &mut TursoStorage,
    ) -> Result<QueueReport, JsValue> {
        let started = query_telemetry::now_ms();
        let mut report = self.report;
        // Serving first would let newer writes overtake the ones in it.
        let read = read_file(sidecar)
            .await
            .map_err(|error| storage_err_js(&error))?;
        let unread = read.is_none();
        let file = read.unwrap_or_default();
        if !unread && file.is_blank() && !self.unwritten {
            return Ok(report);
        }
        if unread || (self.torn && file.imports() > 0) {
            report.lose();
        }
        report.dropped += file.dropped();
        let (end, lost, abandoned) = (file.end(), file.lost(), file.abandoned());
        let own = self.queue.filter(|_| self.unwritten || unread);
        let imports = match own {
            Some(_) => 0,
            None => file.imports(),
        };
        let Some(queue) = own.or(file.into_queue()) else {
            if abandoned && report.outcome == QueueOutcome::None {
                report.outcome = QueueOutcome::Abandoned;
            }
            if lost {
                report.lose();
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
        // Writing to one that could not be read would end what it holds.
        if !unread {
            let attempt = SalvageFile::import_attempt();
            unless_busy(sidecar.write_tail(end, &attempt).await)?;
        }
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
        report.times.import_ms = Some(query_telemetry::now_ms() - started);
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
