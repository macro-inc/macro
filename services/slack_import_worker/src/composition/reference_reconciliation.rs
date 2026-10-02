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
}

impl WorkerReferenceReconciler {
    /// Use the same database as historical batch persistence.
    pub fn new(pool: PgPool, limits: ImportLimits) -> Self {
        Self {
            lookup: WorkerReferenceLookup::new(pool.clone(), limits),
            pool,
            limits,
        }
    }

    async fn reconcile_one(&self) -> PortResult<bool> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let Some(mut fenced) = references::next_in(&mut tx).await? else {
            return Ok(false);
        };
        let work = fenced.work();
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
        for _ in 0..limit.min(50) {
            if !self.reconcile_one().await? {
                break;
            }
        }
        Ok(())
    }
}
