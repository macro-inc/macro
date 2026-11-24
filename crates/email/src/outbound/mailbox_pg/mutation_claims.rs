//! Bounded dependency wakes for draft and overlapping-target command claims.
use super::*;
use std::{future::Future, time::Duration};
use tracing::Instrument;

pub(super) const MUTATION_PROBE_BUDGET: i64 = 128;
const MUTATION_CLAIM_TIMEOUT: Duration = Duration::from_secs(15);

pub(super) struct MutationWindow {
    pub ids: Vec<Uuid>,
    pub maintained: i64,
}

pub(super) struct MutationStep<L> {
    // Reserve conservatively when EXISTS can stop before checking every key.
    pub probes: i64,
    pub budget_exhausted: bool,
    pub blocked: bool,
    pub legacy_wide: bool,
    pub exclusion_overflow: bool,
    pub exclusion_leases_at_least: i64,
    pub lease: Option<L>,
}

/// Both mutation readers keep row locks and budget accounting in one
/// transaction; only their window and per-ID SQL differ.
pub(super) trait MutationAcquirer: Sync {
    type Lease: Send;
    const WORK: &'static str;

    fn link_id(lease: &Self::Lease) -> Uuid;

    fn window(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ) -> impl Future<Output = Result<MutationWindow, MailboxError>> + Send;

    fn acquire(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        id: Uuid,
        remaining: i64,
        first: bool,
    ) -> impl Future<Output = Result<Option<MutationStep<Self::Lease>>, MailboxError>> + Send;
}

#[derive(Clone)]
pub(super) enum MutationWake {
    Draft(Uuid),
    Command(Uuid),
    Label(String),
}

impl MutationWake {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Draft(_) => "drafts",
            Self::Command(_) => "commands",
            Self::Label(_) => "labels",
        }
    }
}

impl PgMailboxSync {
    pub(super) async fn claim_mutation<A: MutationAcquirer>(
        &self,
        acquirer: A,
    ) -> Result<SyncClaim<A::Lease>, MailboxError> {
        let deadline = tokio::time::Instant::now() + MUTATION_CLAIM_TIMEOUT;
        let mut tx = tokio::time::timeout_at(deadline, self.mutation_claim_transaction())
            .await
            .map_err(|_| MailboxError::database(DatabaseFailure::DeadlineExceeded))??;
        let window = tokio::time::timeout_at(deadline, acquirer.window(&mut tx))
            .await
            .map_err(|_| MailboxError::database(DatabaseFailure::DeadlineExceeded))??;
        if window.ids.is_empty() {
            tx.commit().await.map_err(db_error)?;
            return Ok(SyncClaim::Idle);
        }
        let span = tracing::info_span!(
            "email.mailbox.claim",
            mailbox.provider = self.provider.as_str(),
            mailbox.work = A::WORK,
            mailbox.window_rows =
                i64::try_from(window.ids.len()).map_err(|_| MailboxError::Persistence)?,
            mailbox.window_maintained = window.maintained,
            mailbox.probe_budget_used = tracing::field::Empty,
            mailbox.acquire_calls = tracing::field::Empty,
            mailbox.blocked_rows = tracing::field::Empty,
            mailbox.legacy_wide = tracing::field::Empty,
            mailbox.exclusion_overflow = tracing::field::Empty,
            mailbox.exclusion_leases_at_least = tracing::field::Empty,
            mailbox.link_id = tracing::field::Empty,
            mailbox.outcome = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let result = match tokio::time::timeout_at(
            deadline,
            async {
                let mut remaining = MUTATION_PROBE_BUDGET;
                let mut evaluated = false;
                let mut calls = 0_i64;
                let mut blocked_rows = 0_i64;
                let mut legacy_wide = false;
                let mut exclusion_overflow = false;
                let mut exclusion_leases_at_least = 0_i64;
                let mut lease = None;
                // The ordered window stays locked through every per-ID check. A
                // spent budget commits local deferrals and yields to the next turn.
                for id in window.ids {
                    if remaining == 0 {
                        break;
                    }
                    calls += 1;
                    let Some(step) = acquirer.acquire(&mut tx, id, remaining, !evaluated).await?
                    else {
                        continue;
                    };
                    if step.budget_exhausted {
                        if remaining == MUTATION_PROBE_BUDGET {
                            return Err(MailboxError::Persistence);
                        }
                        break;
                    }
                    if step.probes < 0
                        || (!step.legacy_wide && step.probes > remaining)
                        || (step.legacy_wide && evaluated)
                    {
                        return Err(MailboxError::Persistence);
                    }
                    evaluated = true;
                    remaining -= if step.legacy_wide {
                        remaining
                    } else {
                        step.probes
                    };
                    blocked_rows += i64::from(step.blocked);
                    legacy_wide |= step.legacy_wide;
                    exclusion_overflow |= step.exclusion_overflow;
                    exclusion_leases_at_least =
                        exclusion_leases_at_least.max(step.exclusion_leases_at_least);
                    if let Some(acquired) = step.lease {
                        lease = Some(acquired);
                        break;
                    }
                    if !step.blocked {
                        return Err(MailboxError::Persistence);
                    }
                }
                span.record(
                    "mailbox.probe_budget_used",
                    MUTATION_PROBE_BUDGET - remaining,
                );
                span.record("mailbox.acquire_calls", calls);
                span.record("mailbox.blocked_rows", blocked_rows);
                span.record("mailbox.legacy_wide", legacy_wide);
                span.record("mailbox.exclusion_overflow", exclusion_overflow);
                span.record(
                    "mailbox.exclusion_leases_at_least",
                    exclusion_leases_at_least,
                );
                Ok(match lease {
                    Some(lease) => SyncClaim::Acquired(lease),
                    None => SyncClaim::Progress,
                })
            }
            .instrument(span.clone()),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(MailboxError::database(DatabaseFailure::DeadlineExceeded)),
        };
        // Cancelling a COMMIT can report failure after Postgres acquired the
        // lease. Bound evaluation, then await commit without that cancellation.
        let result = match result {
            Ok(claim) => tx
                .commit()
                .instrument(span.clone())
                .await
                .map(|()| claim)
                .map_err(db_error),
            Err(error) => Err(error),
        };
        if let Ok(SyncClaim::Acquired(lease)) = &result {
            span.record("mailbox.link_id", A::link_id(lease).to_string());
        }
        span.record(
            "mailbox.outcome",
            match &result {
                Ok(SyncClaim::Acquired(_)) => "acquired",
                Ok(SyncClaim::Progress) => "progress",
                Ok(SyncClaim::Idle) => "idle",
                Err(_) => "error",
            },
        );
        if result.is_err() {
            span.record("otel.status_code", "ERROR");
        }
        result
    }

    #[tracing::instrument(skip_all, name = "email.mailbox.mutation_wake", fields(
        mailbox.link_id = %mailbox.link_id,
        mailbox.work = wake.as_str(),
        mailbox.rows_woken = tracing::field::Empty,
    ), err)]
    async fn wake_mutation_successors(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        mailbox: MailboxKey,
        wake: MutationWake,
    ) -> Result<(), MailboxError> {
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut **tx)
            .await
            .map_err(db_error)?;
        let (command, draft, label) = match &wake {
            MutationWake::Draft(id) => (None, Some(*id), None),
            MutationWake::Command(id) => (Some(*id), None, None),
            MutationWake::Label(name) => (None, None, Some(name.as_str())),
        };
        let row = sqlx::query_file!(
            "src/outbound/mailbox_pg/mutation_claims/wake.sql",
            mailbox.link_id,
            mailbox.sync_generation,
            command,
            draft,
            label,
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(db_error)?;
        tracing::Span::current().record("mailbox.rows_woken", row.rows_woken);
        Ok(())
    }

    /// Commit the fenced result before the best-effort wake. A fresh snapshot
    /// catches accepted successors without putting settlement behind claim row
    /// locks; a crash or skipped row leaves the <=60-second local backstop.
    pub(super) async fn commit_mutation_and_wake(
        &self,
        tx: sqlx::Transaction<'_, sqlx::Postgres>,
        mailbox: MailboxKey,
        wake: MutationWake,
    ) -> Result<(), MailboxError> {
        tx.commit().await.map_err(db_error)?;
        let result: Result<(), MailboxError> = async {
            let mut after = self.begin_claim().await?;
            Self::wake_mutation_successors(&mut after, mailbox, wake.clone()).await?;
            after.commit().await.map_err(db_error)
        }
        .await;
        if let Err(error) = result {
            tracing::warn!(mailbox.link_id = %mailbox.link_id, mailbox.work = wake.as_str(),
                ?error, "mutation dependency wake retained for the local backstop");
        }
        Ok(())
    }
}
