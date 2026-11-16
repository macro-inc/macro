//! Postgres ledger of CRM population requests.
//!
//! `crm_population_requests` holds one row per mailbox and correspondent, and
//! `crm_population_pauses` one row per mailbox whose attempts are failing.

use crate::domain::crm_population::{
    Claim, ClaimedPopulation, Completion, Concurrency, CrmPopulationLedger, FailedAttempt,
    MAX_POSTPONE, PARK_COOLDOWN, SETTLE,
};
use models_email::service::backfill::PopulateCrmContactPayload;
use rootcause::Report;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Longest failure text kept on a request or a pause.
const MAX_ERROR_CHARS: usize = 2_000;
/// Mailboxes one claim looks at. Bounds the claim's cost when many mailboxes
/// hold requests that are not due yet.
const MAX_HOPS: i32 = 32;

/// Record that `link`'s mail asks for these correspondents to be populated.
///
/// Requests are recorded only for a mailbox that currently contributes to a
/// CRM; when one starts to, its consent seed requests its stored mail. A
/// request for a correspondent that already has one merges into it and
/// postpones a pending attempt by the settling delay, up to a bound.
#[tracing::instrument(skip_all, fields(link_id = %link, requests = requests.len()), err)]
pub async fn request(
    pool: &PgPool,
    link: Uuid,
    requests: &[PopulateCrmContactPayload],
    traceparent: Option<&str>,
) -> Result<(), Report> {
    if requests.is_empty() {
        return Ok(());
    }
    let emails: Vec<&str> = requests.iter().map(|r| r.contact_email.as_str()).collect();
    let names: Vec<Option<&str>> = requests.iter().map(|r| r.contact_name.as_deref()).collect();
    let first: Vec<_> = requests.iter().map(|r| r.first_at).collect();
    let last: Vec<_> = requests.iter().map(|r| r.last_at).collect();
    let sent: Vec<bool> = requests.iter().map(|r| r.is_sent).collect();
    sqlx::query!(
        r#"
        WITH merged AS (
            -- One row per correspondent, so the upsert never touches a row twice.
            SELECT b.contact_email,
                   (array_agg(b.contact_name) FILTER (WHERE b.contact_name IS NOT NULL))[1]
                       AS contact_name,
                   COALESCE(min(b.first_at) FILTER (WHERE b.is_sent), min(b.first_at)) AS first_at,
                   max(b.last_at) AS last_at,
                   bool_or(b.is_sent) AS is_sent
            FROM unnest($2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::bool[])
                AS b (contact_email, contact_name, first_at, last_at, is_sent)
            WHERE EXISTS (
                SELECT 1 FROM crm_email_consent c WHERE c.link_id = $1 AND c.enabled
            )
            GROUP BY b.contact_email
        )
        INSERT INTO crm_population_requests AS r
            (link_id, contact_email, contact_name, first_at, last_at, is_sent, due_at, traceparent)
        SELECT $1, m.contact_email, m.contact_name, m.first_at, m.last_at, m.is_sent,
               now() + make_interval(secs => $7), $10
        FROM merged m
        -- Concurrent batches lock their shared rows in one order.
        ORDER BY m.contact_email
        ON CONFLICT (link_id, contact_email) DO UPDATE SET
            contact_name = COALESCE(r.contact_name, EXCLUDED.contact_name),
            -- The sent range anchors a first interaction; a received one never moves it.
            first_at = CASE
                WHEN EXCLUDED.is_sent AND NOT r.is_sent THEN EXCLUDED.first_at
                WHEN r.is_sent AND NOT EXCLUDED.is_sent THEN r.first_at
                ELSE LEAST(r.first_at, EXCLUDED.first_at)
            END,
            last_at = GREATEST(r.last_at, EXCLUDED.last_at),
            is_sent = r.is_sent OR EXCLUDED.is_sent,
            generation = r.generation + 1,
            traceparent = COALESCE(EXCLUDED.traceparent, r.traceparent),
            -- A request parked longer than the cooldown starts over.
            parked_at = CASE
                WHEN r.parked_at <= now() - make_interval(secs => $9) THEN NULL
                ELSE r.parked_at
            END,
            attempts = CASE
                WHEN r.parked_at <= now() - make_interval(secs => $9) THEN 0
                ELSE r.attempts
            END,
            requested_at = CASE
                WHEN r.parked_at <= now() - make_interval(secs => $9) THEN now()
                ELSE r.requested_at
            END,
            -- Never earlier than a lease or a retry delay, and never
            -- postponed past the bound by a stream of requests.
            due_at = CASE
                WHEN r.parked_at <= now() - make_interval(secs => $9) THEN EXCLUDED.due_at
                ELSE GREATEST(
                    r.due_at,
                    LEAST(EXCLUDED.due_at, r.requested_at + make_interval(secs => $8))
                )
            END
        "#,
        link,
        &emails as &[&str],
        &names as &[Option<&str>],
        &first,
        &last,
        &sent,
        SETTLE.as_secs_f64(),
        MAX_POSTPONE.as_secs_f64(),
        PARK_COOLDOWN.as_secs_f64(),
        traceparent,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The request ledger over a connection pool. The workers that attempt a
/// request report what failed, so a failed statement is a warning here.
#[derive(Debug, Clone)]
pub struct PgCrmPopulationLedger(pub PgPool);

impl CrmPopulationLedger for PgCrmPopulationLedger {
    #[tracing::instrument(skip_all, err(level = "warn"))]
    async fn claim(
        &self,
        after: Uuid,
        lease: Duration,
        limits: Concurrency,
    ) -> Result<Claim, Report> {
        let row = sqlx::query!(
            r#"
            WITH RECURSIVE budget AS (
                -- Attempts in flight across every mailbox; the index holds
                -- only claimed requests.
                SELECT count(*) < $5::int AS free
                FROM crm_population_requests
                WHERE claimed_until > now()
            ), hop AS (
                -- Walks the mailboxes that have unparked requests, in id order
                -- from the caller's position, one index probe each. It stops
                -- at the first that may take work now, or after `$4` of them.
                SELECT $1::uuid AS link_id, FALSE AS ready, 0 AS n
                UNION ALL
                SELECT next.link_id,
                       next.due_at <= now()
                       AND COALESCE(pause.paused_until <= now(), TRUE)
                       AND (
                           SELECT count(*)
                           FROM crm_population_requests f
                           WHERE f.link_id = next.link_id AND f.claimed_until > now()
                       ) < CASE
                           -- A failing mailbox probes with one attempt at a time.
                           WHEN pause.paused_until IS NULL THEN $3::int
                           ELSE 1
                       END,
                       h.n + 1
                FROM hop h
                CROSS JOIN LATERAL (
                    -- The next mailbox and its earliest due time.
                    SELECT r.link_id, r.due_at
                    FROM crm_population_requests r
                    WHERE r.parked_at IS NULL AND r.link_id > h.link_id
                    ORDER BY r.link_id, r.due_at
                    LIMIT 1
                ) next
                CROSS JOIN LATERAL (
                    -- Null unless the mailbox is failing. A scalar lookup is
                    -- one index probe however the planner sizes the table.
                    SELECT (
                        SELECT p.paused_until
                        FROM crm_population_pauses p
                        WHERE p.link_id = next.link_id
                    ) AS paused_until
                ) pause
                WHERE NOT h.ready AND h.n < $4 AND (SELECT free FROM budget)
            ), reached AS (
                SELECT link_id, ready, n FROM hop ORDER BY n DESC LIMIT 1
            ), picked AS (
                SELECT r.link_id, r.contact_email
                FROM crm_population_requests r
                WHERE r.link_id = (SELECT link_id FROM reached WHERE ready)
                  AND r.parked_at IS NULL
                  AND r.due_at <= now()
                ORDER BY r.due_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            ), claimed AS (
                UPDATE crm_population_requests r
                SET claimed_until = now() + make_interval(secs => $2),
                    due_at = now() + make_interval(secs => $2),
                    attempts = r.attempts + 1
                FROM picked, email_links l
                WHERE r.link_id = picked.link_id
                  AND r.contact_email = picked.contact_email
                  AND l.id = r.link_id
                RETURNING r.link_id, l.macro_id AS owner, l.email_address AS mailbox,
                          r.contact_email, r.contact_name, r.first_at, r.last_at, r.is_sent,
                          r.generation, r.attempts, r.claimed_until AS lease, r.traceparent,
                          COALESCE(
                              (SELECT p.failures FROM crm_population_pauses p
                               WHERE p.link_id = r.link_id),
                              0
                          ) AS mailbox_failures
            )
            SELECT NOT budget.free AS "busy!",
                   CASE WHEN reached.ready OR reached.n >= $4 THEN reached.link_id END
                       AS resume_after,
                   claimed.link_id AS "link_id?", claimed.owner AS "owner?",
                   claimed.mailbox AS "mailbox?", claimed.contact_email AS "contact_email?",
                   claimed.contact_name, claimed.first_at AS "first_at?",
                   claimed.last_at AS "last_at?", claimed.is_sent AS "is_sent?",
                   claimed.generation AS "generation?", claimed.attempts AS "attempts?",
                   claimed.lease AS "lease?", claimed.traceparent,
                   claimed.mailbox_failures AS "mailbox_failures?"
            FROM reached
            CROSS JOIN budget
            LEFT JOIN claimed ON TRUE
            "#,
            after,
            lease.as_secs_f64(),
            i32::from(limits.mailbox),
            MAX_HOPS,
            i32::from(limits.fleet),
        )
        .fetch_one(&self.0)
        .await?;
        let claimed = match (
            row.link_id,
            row.owner,
            row.mailbox,
            row.contact_email,
            row.first_at,
            row.last_at,
            row.is_sent,
            row.generation,
            row.attempts,
            row.lease,
        ) {
            (
                Some(link_id),
                Some(owner),
                Some(mailbox),
                Some(contact_email),
                Some(first_at),
                Some(last_at),
                Some(is_sent),
                Some(generation),
                Some(attempts),
                Some(lease),
            ) => Some(ClaimedPopulation {
                link_id,
                owner,
                mailbox,
                request: PopulateCrmContactPayload {
                    contact_email,
                    contact_name: row.contact_name,
                    first_at,
                    last_at,
                    is_sent,
                },
                generation,
                attempt: u8::try_from(attempts).unwrap_or(u8::MAX),
                lease,
                mailbox_failures: u32::try_from(row.mailbox_failures.unwrap_or(0))
                    .unwrap_or(u32::MAX),
                traceparent: row.traceparent,
            }),
            _ => None,
        };
        Ok(Claim {
            claimed,
            resume_after: row.resume_after,
            busy: row.busy,
        })
    }

    #[tracing::instrument(skip_all, fields(link_id = %claimed.link_id), err(level = "warn"))]
    async fn complete(
        &self,
        claimed: &ClaimedPopulation,
        settle: Duration,
    ) -> Result<Completion, Report> {
        let removed = sqlx::query!(
            r#"
            DELETE FROM crm_population_requests
            WHERE link_id = $1 AND contact_email = $2 AND claimed_until = $3 AND generation = $4
            "#,
            claimed.link_id,
            claimed.request.contact_email,
            claimed.lease,
            claimed.generation,
        )
        .execute(&self.0)
        .await?
        .rows_affected();
        let completion = if removed > 0 {
            Completion::Removed
        } else {
            // Requested again during the attempt: the stored mail may have
            // changed after the attempt read it, so it runs once more.
            let requeued = sqlx::query!(
                r#"
                UPDATE crm_population_requests
                SET claimed_until = NULL,
                    due_at = now() + make_interval(secs => $4),
                    requested_at = now(),
                    attempts = 0,
                    last_error = NULL
                WHERE link_id = $1 AND contact_email = $2 AND claimed_until = $3
                "#,
                claimed.link_id,
                claimed.request.contact_email,
                claimed.lease,
                settle.as_secs_f64(),
            )
            .execute(&self.0)
            .await?
            .rows_affected();
            if requeued > 0 {
                Completion::Requeued
            } else {
                Completion::Superseded
            }
        };
        if claimed.mailbox_failures > 0 {
            sqlx::query!(
                "DELETE FROM crm_population_pauses WHERE link_id = $1",
                claimed.link_id
            )
            .execute(&self.0)
            .await?;
        }
        Ok(completion)
    }

    #[tracing::instrument(skip_all, fields(link_id = %claimed.link_id), err(level = "warn"))]
    async fn fail(
        &self,
        claimed: &ClaimedPopulation,
        failure: &FailedAttempt<'_>,
    ) -> Result<(), Report> {
        let error: String = failure.error.chars().take(MAX_ERROR_CHARS).collect();
        let recorded = sqlx::query!(
            r#"
            UPDATE crm_population_requests
            SET claimed_until = NULL,
                last_error = $4,
                due_at = COALESCE(now() + make_interval(secs => $5), due_at),
                parked_at = CASE WHEN $5::float8 IS NULL THEN now() END
            WHERE link_id = $1 AND contact_email = $2 AND claimed_until = $3
            "#,
            claimed.link_id,
            claimed.request.contact_email,
            claimed.lease,
            error,
            failure.retry_after.map(|delay| delay.as_secs_f64()),
        )
        .execute(&self.0)
        .await?
        .rows_affected();
        if recorded == 0 {
            // Another attempt owns the request; this one's failure is stale.
            return Ok(());
        }
        sqlx::query!(
            r#"
            INSERT INTO crm_population_pauses AS p (link_id, failures, paused_until, last_error)
            VALUES ($1, $2, now() + make_interval(secs => $3), $4)
            ON CONFLICT (link_id) DO UPDATE SET
                failures = GREATEST(p.failures, EXCLUDED.failures),
                paused_until = GREATEST(p.paused_until, EXCLUDED.paused_until),
                last_error = EXCLUDED.last_error,
                updated_at = now()
            "#,
            claimed.link_id,
            i32::try_from(failure.mailbox_failures).unwrap_or(i32::MAX),
            failure.pause.as_secs_f64(),
            error,
        )
        .execute(&self.0)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(link_id = %claimed.link_id), err(level = "warn"))]
    async fn release(&self, claimed: &ClaimedPopulation) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE crm_population_requests
            SET claimed_until = NULL, due_at = now(), attempts = GREATEST(attempts - 1, 0)
            WHERE link_id = $1 AND contact_email = $2 AND claimed_until = $3
            "#,
            claimed.link_id,
            claimed.request.contact_email,
            claimed.lease,
        )
        .execute(&self.0)
        .await?;
        Ok(())
    }
}
