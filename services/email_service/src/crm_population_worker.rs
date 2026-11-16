//! Lanes that work off the CRM population ledger.
//!
//! A lane passes over the mailboxes that have requests, attempting one due
//! request of each in turn, and idles after a pass that found nothing due.
//! The lanes are the only place CRM population runs, so their number bounds
//! the populations in flight whatever is pending, and a population that is
//! slow or failing holds a lane rather than a backfill or sync worker. The
//! ledger also refuses claims past a fleet-wide number of attempts in flight.

use crate::composition::workers::CrmServiceType;
use crate::outbound::crm_population::CrmPopulationContacts;
use email::domain::crm_population::{
    ATTEMPT_TIMEOUT, ClaimedPopulation, CrmPopulationLedger, CrmPopulationService, CrmPopulator,
};
use email::outbound::crm_population_pg::PgCrmPopulationLedger;
use rand::Rng as _;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;
use uuid::Uuid;

/// Lanes per process: the populations it runs at once. The ledger caps the
/// attempts in flight across all processes, so more lanes here would mostly
/// wait; every process runs one so that any of them can work the ledger off.
pub const LANES: usize = 1;
/// Longest pause of a lane that found nothing to claim.
const IDLE: Duration = Duration::from_secs(3);
/// Pause of a lane whose claim failed.
const CLAIM_RETRY: Duration = Duration::from_secs(15);
/// Longest the server runs one statement of a population. An attempt the lane
/// gives up on leaves its statement running there, no longer counted by the
/// ledger; this ends it, and normally fails the attempt before the lane's own
/// timeout does.
const STATEMENT_TIMEOUT: Duration = Duration::from_secs(120);
const _: () = assert!(STATEMENT_TIMEOUT.as_secs() * 2 <= ATTEMPT_TIMEOUT.as_secs());

/// The ledger and the CRM the lanes of one process share.
pub type PopulationService =
    CrmPopulationService<PgCrmPopulationLedger, CrmPopulationContacts<CrmServiceType>>;

/// Build the lanes' service over `crm`, which should work on a
/// [`population_pool`]. The ledger gets connections of its own, one per lane,
/// with a statement timeout: its bookkeeping neither waits behind a
/// population nor can a claim run on.
pub fn service(db: &PgPool, crm: CrmServiceType) -> Arc<PopulationService> {
    Arc::new(CrmPopulationService {
        ledger: ledger(db),
        crm: CrmPopulationContacts(crm),
    })
}

/// Connections for the populations themselves, to the database `db` connects
/// to. They are apart from every other worker's, so population neither takes
/// their connections nor waits for one, and each ends a statement that runs
/// past [`STATEMENT_TIMEOUT`]. Their number is the most backends this process
/// can keep busy with population, whatever the ledger has handed out.
pub fn population_pool(db: &PgPool) -> PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(LANES as u32 * 2)
        .connect_lazy_with((*db.connect_options()).clone().options([
            ("lock_timeout", "5s".to_owned()),
            (
                "statement_timeout",
                format!("{}s", STATEMENT_TIMEOUT.as_secs()),
            ),
        ]))
}

fn ledger(db: &PgPool) -> PgCrmPopulationLedger {
    PgCrmPopulationLedger(
        sqlx::postgres::PgPoolOptions::new()
            .max_connections(LANES as u32)
            .connect_lazy_with(
                (*db.connect_options())
                    .clone()
                    .options([("lock_timeout", "5s"), ("statement_timeout", "10s")]),
            ),
    )
}

/// Run one lane until cancellation.
pub fn run(
    service: Arc<PopulationService>,
    cancellation: CancellationToken,
) -> impl Future<Output = ()> {
    lane(service, cancellation)
}

async fn lane<L, C>(service: Arc<CrmPopulationService<L, C>>, cancellation: CancellationToken)
where
    L: CrmPopulationLedger,
    C: CrmPopulator,
{
    // The lane passes over the mailboxes again and again, attempting one
    // request of each mailbox that may take work.
    let mut after = Uuid::nil();
    let mut attempted_this_pass = false;
    while !cancellation.is_cancelled() {
        // A claim is not interrupted: a claim the lane never learned of would
        // hold its request until the lease lapsed.
        let pause = match service.claim(after).await {
            // The pass picks up where it is once other lanes have finished.
            Ok(claim) if claim.busy => rand::rng().random_range(IDLE / 3..=IDLE),
            Ok(claim) => {
                if let Some(claimed) = &claim.claimed {
                    attempted_this_pass = true;
                    attempt(&service, claimed, &cancellation).await;
                }
                match claim.resume_after {
                    Some(mailbox) => {
                        after = mailbox;
                        continue;
                    }
                    None => {
                        after = Uuid::nil();
                        if std::mem::take(&mut attempted_this_pass) {
                            continue;
                        }
                        // Nothing was due anywhere. Lanes that idle together
                        // spread out again.
                        rand::rng().random_range(IDLE / 3..=IDLE)
                    }
                }
            }
            Err(error) => {
                tracing::warn!(error = ?error, "Could not claim a CRM population request");
                CLAIM_RETRY
            }
        };
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = tokio::time::sleep(pause) => {}
        }
    }
}

/// Attempt one claimed request, or hand it back when the lane is shut down
/// first.
async fn attempt<L, C>(
    service: &CrmPopulationService<L, C>,
    claimed: &ClaimedPopulation,
    cancellation: &CancellationToken,
) where
    L: CrmPopulationLedger,
    C: CrmPopulator,
{
    let span = tracing::info_span!(
        "crm.population.attempt",
        link_id = %claimed.link_id,
        attempt = claimed.attempt,
        outcome = tracing::field::Empty,
    );
    sqs_client::email::trace_context::adopt(&span, claimed.traceparent.as_deref());
    async {
        let outcome = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                service.release(claimed).await;
                "released"
            }
            outcome = service.attempt(claimed) => outcome.as_str(),
        };
        tracing::Span::current().record("outcome", outcome);
    }
    .instrument(span)
    .await;
}

#[cfg(test)]
mod test;
