//! Warm sessions use list_hidden without a thread; hidden mentions always have a thread.
use super::*;
use crate::domain::warm::{WarmClaim, WarmMissReason, WarmSessionLifecycle};
use std::{future::Future, pin::Pin};

impl<B: BotFacts + 'static> WarmSessionLifecycle for PgAgentSessionRepo<B> {
    fn claim<'a>(
        &'a self,
        id: AgentSessionId,
        owner: &'a Owner,
        bot: BotId,
        model: &'a str,
        instructions: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<WarmClaim>> + Send + 'a>> {
        Box::pin(async move {
            let user = session_owner_user(owner)?;
            let mut transaction = self.pool.begin().await.context("begin warm claim")?;
            // One statement: the snapshot that explains a miss is the one the claim ran against.
            let row = sqlx::query!(
                r#"
                WITH candidate AS (
                    SELECT
                        true AS found,
                        list_hidden AND thread_id IS NULL AS warm,
                        owner_id = $2 AS owner_matches,
                        bot_id = $3 AS bot_matches,
                        model = $4 AS model_matches,
                        instructions IS NOT DISTINCT FROM $5 AS instructions_match,
                        COALESCE(status != 'disconnected'
                            AND NOT (status = 'event' AND status_event_name = 'disconnected'), false) AS live,
                        created_at > NOW() - INTERVAL '10 minutes' AS fresh
                    FROM agent_session WHERE id = $1
                ), claimed AS (
                    UPDATE agent_session SET list_hidden = false
                    WHERE id = $1 AND owner_id = $2 AND bot_id = $3 AND model = $4
                      AND instructions IS NOT DISTINCT FROM $5
                      AND list_hidden AND thread_id IS NULL
                      AND status != 'disconnected'
                      AND NOT (status = 'event' AND status_event_name = 'disconnected')
                      AND created_at > NOW() - INTERVAL '10 minutes'
                    RETURNING id
                )
                SELECT
                    EXISTS (SELECT 1 FROM claimed) AS "claimed!",
                    candidate.found AS "found?",
                    candidate.warm AS "warm?",
                    candidate.owner_matches AS "owner_matches?",
                    candidate.bot_matches AS "bot_matches?",
                    candidate.model_matches AS "model_matches?",
                    candidate.instructions_match AS "instructions_match?",
                    candidate.live AS "live?",
                    candidate.fresh AS "fresh?"
                FROM (SELECT 1) AS one LEFT JOIN candidate ON true
            "#,
                id.as_uuid(),
                user.as_ref(),
                bot.as_uuid(),
                model,
                instructions
            )
            .fetch_one(&mut *transaction)
            .await
            .context("claim warm session")?;
            let checks = [
                (row.warm, WarmMissReason::NotWarm),
                (row.owner_matches, WarmMissReason::OwnerMismatch),
                (row.bot_matches, WarmMissReason::BotMismatch),
                (row.model_matches, WarmMissReason::ModelMismatch),
                (row.instructions_match, WarmMissReason::InstructionsMismatch),
                (row.live, WarmMissReason::Disconnected),
                (row.fresh, WarmMissReason::Expired),
            ];
            let claim = if row.claimed {
                WarmClaim::Claimed
            } else if row.found.is_none() {
                WarmClaim::Missed(WarmMissReason::NotFound)
            } else {
                WarmClaim::Missed(
                    checks
                        .into_iter()
                        .find_map(|(held, reason)| (held != Some(true)).then_some(reason))
                        .unwrap_or(WarmMissReason::LostRace),
                )
            };
            if claim == WarmClaim::Claimed {
                upsert_user_history(&mut transaction, user.as_ref(), &id.as_uuid())
                    .await
                    .context("record claimed warm session history")?;
            }
            transaction.commit().await.context("commit warm claim")?;
            Ok(claim)
        })
    }
    fn expire(&self) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionId>>> + Send + '_>> {
        Box::pin(async move {
            // Mark under row locks before deleting: a concurrent claim cannot win
            // after this operation, and a crash leaves a retryable expired row.
            let rows = sqlx::query!(
                r#"
                UPDATE agent_session SET status = 'disconnected'
                WHERE id IN (
                    SELECT id FROM agent_session
                    WHERE list_hidden AND thread_id IS NULL
                      AND created_at <= NOW() - INTERVAL '10 minutes'
                    ORDER BY created_at LIMIT 64 FOR UPDATE SKIP LOCKED
                ) RETURNING id
            "#
            )
            .fetch_all(&self.pool)
            .await
            .context("expire warm sessions")?;
            let mut expired = Vec::new();
            for row in rows {
                let id = AgentSessionId::new_from_uuid(row.id);
                expired.push(id);
            }
            Ok(expired)
        })
    }
}
