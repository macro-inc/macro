//! The Postgres store of solver runs (`agent_captcha_runs`) and CAPTCHA
//! solves (`agent_captcha_solves`). Starting a run and claiming a solve hold
//! a per-agent transaction-scoped advisory lock, so two replicas can't both
//! pass a cap; a model call is taken by one conditional `UPDATE`.

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction, types::Json};
use uuid::Uuid;

use super::{
    BudgetLimit, Claimed, LedgerError, RunLimits, RunRefusal, RunStart, SolveClaim, SolveLedger,
    SolverRunId, SolverRuns,
};
use crate::captcha_gateway::{KeptOutcome, SolveOutcome, VendorErrorKind};

pub(crate) struct PgSolverRuns {
    pool: PgPool,
    limits: RunLimits,
}

impl PgSolverRuns {
    pub(crate) fn new(pool: PgPool, limits: RunLimits) -> Self {
        Self { pool, limits }
    }
}

fn seconds(duration: std::time::Duration) -> f64 {
    duration.as_secs_f64()
}

/// Serialize one agent's run starts and solve claims, across replicas.
async fn lock_agent(
    tx: &mut Transaction<'_, Postgres>,
    agent: &MacroUserIdStr<'static>,
) -> Result<(), LedgerError> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('agent-captcha:' || $1, 0))",
        agent.as_ref()
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Why `run` can't be spent, read after the conditional update refused it.
/// A run past its expiry is expired; one that ended early is used up when
/// `used_up` says its counts ran out, and ended otherwise.
async fn refusal(
    executor: impl sqlx::PgExecutor<'_>,
    run: SolverRunId,
    agent: &MacroUserIdStr<'static>,
    used_up: impl FnOnce(i32, i32, i32) -> RunRefusal,
) -> Result<RunRefusal, LedgerError> {
    let row = sqlx::query!(
        r#"SELECT user_id, expires_at <= now() AS "expired!", ended_at IS NOT NULL AS "ended!",
                  model_calls_used, model_calls_in_flight, solves_used
           FROM agent_captcha_runs WHERE id = $1"#,
        run.0
    )
    .fetch_optional(executor)
    .await?;
    Ok(match row {
        Some(row) if row.user_id == agent.as_ref() => {
            if row.expired {
                RunRefusal::Expired
            } else {
                let refused = used_up(
                    row.model_calls_used,
                    row.model_calls_in_flight,
                    row.solves_used,
                );
                if row.ended && refused != RunRefusal::Exhausted {
                    RunRefusal::Ended
                } else {
                    refused
                }
            }
        }
        _ => RunRefusal::Required,
    })
}

#[async_trait]
impl SolverRuns for PgSolverRuns {
    async fn start(&self, agent: &MacroUserIdStr<'static>) -> Result<RunStart, LedgerError> {
        let mut tx = self.pool.begin().await?;
        lock_agent(&mut tx, agent).await?;
        let counts = sqlx::query!(
            r#"SELECT count(*) FILTER (WHERE expires_at > now() AND ended_at IS NULL) AS "live!",
                      count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS "hourly!",
                      count(*) AS "daily!"
               FROM agent_captcha_runs
               WHERE user_id = $1 AND created_at > now() - interval '1 day'"#,
            agent.as_ref()
        )
        .fetch_one(&mut *tx)
        .await?;
        let limit = if counts.live >= i64::from(self.limits.concurrent) {
            Some(BudgetLimit::Concurrent)
        } else if counts.hourly >= i64::from(self.limits.hourly) {
            Some(BudgetLimit::Hourly)
        } else if counts.daily >= i64::from(self.limits.daily) {
            Some(BudgetLimit::Daily)
        } else {
            None
        };
        if let Some(limit) = limit {
            return Ok(RunStart::BudgetExceeded(limit));
        }

        let run_id = SolverRunId(macro_uuid::generate_uuid_v7());
        let expires_at = sqlx::query_scalar!(
            r#"INSERT INTO agent_captcha_runs (id, user_id, expires_at)
               VALUES ($1, $2, now() + make_interval(secs => $3))
               RETURNING expires_at"#,
            run_id.0,
            agent.as_ref(),
            seconds(self.limits.lifetime),
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(RunStart::Started { run_id, expires_at })
    }

    async fn take_model_call(
        &self,
        run: SolverRunId,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<Result<(), RunRefusal>, LedgerError> {
        let taken = sqlx::query_scalar!(
            r#"UPDATE agent_captcha_runs
               SET model_calls_used = model_calls_used + 1,
                   model_calls_in_flight = model_calls_in_flight + 1
               WHERE id = $1 AND user_id = $2 AND expires_at > now() AND ended_at IS NULL
                 AND model_calls_used < $3 AND model_calls_in_flight < $4
               RETURNING id"#,
            run.0,
            agent.as_ref(),
            i32::from(self.limits.model_calls),
            i32::from(self.limits.model_calls_in_flight),
        )
        .fetch_optional(&self.pool)
        .await?;
        if taken.is_some() {
            return Ok(Ok(()));
        }
        let model_calls = i32::from(self.limits.model_calls);
        refusal(&self.pool, run, agent, |used, _, _| {
            if used >= model_calls {
                RunRefusal::Exhausted
            } else {
                RunRefusal::Busy
            }
        })
        .await
        .map(Err)
    }

    async fn end(
        &self,
        run: SolverRunId,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<(), LedgerError> {
        sqlx::query!(
            r#"UPDATE agent_captcha_runs SET ended_at = now()
               WHERE id = $1 AND user_id = $2 AND ended_at IS NULL"#,
            run.0,
            agent.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn release_model_call(&self, run: SolverRunId) -> Result<(), LedgerError> {
        sqlx::query!(
            r#"UPDATE agent_captcha_runs SET model_calls_in_flight = model_calls_in_flight - 1
               WHERE id = $1 AND model_calls_in_flight > 0"#,
            run.0
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[async_trait]
impl SolveLedger for PgSolverRuns {
    async fn claim(&self, claim: &SolveClaim) -> Result<Claimed, LedgerError> {
        let agent = claim.agent.as_ref();
        let abandoned_after = seconds(claim.caps.abandoned_after);
        let mut tx = self.pool.begin().await?;
        lock_agent(&mut tx, &claim.agent).await?;

        let known = sqlx::query!(
            r#"SELECT user_id, outcome AS "outcome: Json<KeptOutcome>",
                      created_at < now() - make_interval(secs => $2) AS "abandoned!"
               FROM agent_captcha_solves WHERE solve_id = $1"#,
            claim.solve_id,
            abandoned_after,
        )
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(known) = known {
            return Ok(match known {
                known if known.user_id != agent => Claimed::OtherAgent,
                known => match known.outcome {
                    Some(Json(kept)) => Claimed::Finished(kept.replayed()),
                    None if known.abandoned => Claimed::Finished(SolveOutcome::VendorError {
                        kind: VendorErrorKind::Unavailable,
                    }),
                    None => Claimed::InProgress,
                },
            });
        }
        if claim.key_blocked {
            return Ok(Claimed::KeyBlocked);
        }

        let taken = sqlx::query_scalar!(
            r#"UPDATE agent_captcha_runs SET solves_used = solves_used + 1
               WHERE id = $1 AND user_id = $2 AND expires_at > now() AND ended_at IS NULL
                 AND solves_used < $3
               RETURNING id"#,
            claim.run.0,
            agent,
            i32::from(self.limits.solves),
        )
        .fetch_optional(&mut *tx)
        .await?;
        if taken.is_none() {
            let solves = i32::from(self.limits.solves);
            let refused = refusal(&mut *tx, claim.run, &claim.agent, |_, _, used| {
                // A live run that refused a claim has used its solves up.
                if used >= solves {
                    RunRefusal::Exhausted
                } else {
                    RunRefusal::Ended
                }
            })
            .await?;
            return Ok(Claimed::Refused(refused));
        }

        let counts = sqlx::query!(
            r#"SELECT count(*) FILTER (
                          WHERE finished_at IS NULL
                            AND created_at >= now() - make_interval(secs => $2)
                      ) AS "in_flight!",
                      count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS "hourly!",
                      count(*) AS "daily!"
               FROM agent_captcha_solves
               WHERE user_id = $1 AND created_at > now() - interval '1 day'"#,
            agent,
            abandoned_after,
        )
        .fetch_one(&mut *tx)
        .await?;
        let limit = if counts.in_flight >= i64::from(claim.caps.concurrent) {
            Some(BudgetLimit::Concurrent)
        } else if counts.hourly >= i64::from(claim.caps.hourly) {
            Some(BudgetLimit::Hourly)
        } else if counts.daily >= i64::from(claim.caps.daily) {
            Some(BudgetLimit::Daily)
        } else {
            None
        };
        // Dropping the transaction gives the run its solve back.
        if let Some(limit) = limit {
            return Ok(Claimed::BudgetExceeded(limit));
        }

        // Another agent may hold this id: its claim locks a different agent.
        let inserted = sqlx::query!(
            r#"INSERT INTO agent_captcha_solves (solve_id, run_id, user_id)
               VALUES ($1, $2, $3) ON CONFLICT (solve_id) DO NOTHING"#,
            claim.solve_id,
            claim.run.0,
            agent,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if inserted == 0 {
            return Ok(Claimed::OtherAgent);
        }
        tx.commit().await?;
        Ok(Claimed::New)
    }

    async fn finish(
        &self,
        solve_id: Uuid,
        outcome: &SolveOutcome,
        task_id: Option<&str>,
    ) -> Result<(), LedgerError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            r#"UPDATE agent_captcha_solves SET finished_at = now(), outcome = $2, task_id = $3
               WHERE solve_id = $1"#,
            solve_id,
            Json(KeptOutcome::from(outcome)) as _,
            task_id,
        )
        .execute(&mut *tx)
        .await?;
        // The run's last solve is in: the run is over, whether or not its
        // tool says so, and the agent may start the next one at once.
        sqlx::query!(
            r#"UPDATE agent_captcha_runs AS run SET ended_at = now()
               WHERE run.id = (SELECT run_id FROM agent_captcha_solves WHERE solve_id = $1)
                 AND run.ended_at IS NULL AND run.solves_used >= $2
                 AND NOT EXISTS (
                     SELECT 1 FROM agent_captcha_solves AS solve
                     WHERE solve.run_id = run.id AND solve.finished_at IS NULL
                 )"#,
            solve_id,
            i32::from(self.limits.solves),
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
