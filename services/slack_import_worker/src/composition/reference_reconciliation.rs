//! Cross-domain atomic reconciliation: the import owner holds the job fence,
//! domain policy resolves disclosure, and the message owner guards body mutation.

use messages::{
    domain::historical::HistoricalBodyPatch, outbound::pg_message_repo::PgMessageRepository,
};
use slack_integration::{
    domain::{
        models::*,
        ports::{PortResult, ReferenceReconciler},
        reference_reconciliation::final_body,
    },
    outbound::pg_slack_import_repo::references,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::{references::WorkerReferenceLookup, retry};

/// Bounded maintenance capability. No uploads, import claims or live edit services.
pub struct WorkerReferenceReconciler {
    pool: PgPool,
    lookup: WorkerReferenceLookup,
    limits: ImportLimits,
    cursor: tokio::sync::Mutex<Option<JobId>>,
}

impl WorkerReferenceReconciler {
    /// Use the same database as historical batch persistence.
    pub fn new(pool: PgPool, limits: ImportLimits) -> Self {
        Self {
            lookup: WorkerReferenceLookup::new(pool.clone(), limits),
            pool,
            limits,
            cursor: tokio::sync::Mutex::new(None),
        }
    }

    async fn reconcile_one(&self, cursor: &mut Option<JobId>) -> PortResult<bool> {
        let Some(expected) = references::peek_next(&self.pool, *cursor).await? else {
            *cursor = None;
            return Ok(false);
        };
        let _permit =
            match message_write_gate::acquire("channel", &expected.channel.to_string()).await {
                Ok(permit) => permit,
                Err(_) => {
                    // A busy channel must not prevent a later job from being tried.
                    *cursor = Some(expected.job);
                    return Ok(true);
                }
            };
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let Some(mut fenced) = references::next_for_job_in(&mut tx, expected.job).await? else {
            tx.rollback().await.map_err(retry)?;
            *cursor = Some(expected.job);
            return Ok(true);
        };
        let work = fenced.work();
        if work.job != expected.job
            || work.message != expected.message
            || work.channel != expected.channel
        {
            // Another worker advanced discovery while admission was pending.
            // Release the new fence without touching this different message.
            drop(fenced);
            tx.rollback().await.map_err(retry)?;
            *cursor = Some(expected.job);
            return Ok(true);
        }
        let context = self.lookup.context(work.team, work.job).await?;
        let patch = match (&work.template, context) {
            (Some(template), Some(context)) => {
                final_body(&self.lookup, &context, template, work.version, &self.limits)
                    .await?
                    .map(|body| HistoricalBodyPatch {
                        message_id: work.message,
                        channel_id: work.channel,
                        job_id: Uuid::from(work.job),
                        importer_version: work.version,
                        expected_body: template.body.clone(),
                        body,
                    })
            }
            _ => None,
        };
        let changed = if let Some(patch) = patch {
            // Resolution above is a fresh disclosure check immediately before this
            // compare-and-set. Never trust authorization from the original import.
            PgMessageRepository::patch_historical_body_in(fenced.transaction(), &patch)
                .await
                .map_err(retry)?
        } else {
            false
        };
        fenced.finish(changed).await?;
        tx.commit().await.map_err(retry)?;
        Ok(true)
    }
}

impl ReferenceReconciler for WorkerReferenceReconciler {
    async fn reconcile_references(&self, limit: u32) -> PortResult<()> {
        // Serialize this worker's cursor before acquiring any pool connection.
        // Retain it across capped passes so a long blocked prefix cannot starve
        // a later job. Successful work keeps the prior cursor to drain its job.
        let mut cursor = self.cursor.lock().await;
        for _ in 0..limit.min(50) {
            if !self.reconcile_one(&mut cursor).await? {
                break;
            }
        }
        Ok(())
    }
}
