//! A CRM source whose rollout leaves the user out: refused before a run
//! starts, and an adopted run reads nothing. HubSpot stands in for any
//! flagged source, through a rollout that turns it off.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use import_hubspot::domain::{HubspotConnections, HubspotError, Inventory, ReadProgress};

use super::hubspot::crm_for;
use super::*;
use crate::domain::ports::{ImportError, ImportRollout};
use crate::domain::service::WorkspaceImporter;
use crate::domain::service::workspace::Importer;

/// A rollout that leaves out one source.
struct Without(ImportSource);

#[async_trait]
impl ImportRollout for Without {
    async fn enabled_for(&self, _: &MacroUserIdStr<'static>, source: ImportSource) -> bool {
        source != self.0
    }
}

/// A connected HubSpot that counts every read and reads nothing.
#[derive(Default)]
struct Counting {
    reads: AtomicUsize,
}

#[async_trait]
impl HubspotConnections for Counting {
    async fn connected(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<bool, HubspotError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    }
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> std::result::Result<Inventory, HubspotError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Err(HubspotError::Unavailable)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_source_the_rollout_leaves_out_is_refused_and_an_adopted_run_reads_nothing(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "rollout-owner", team).await;
    let reader = Arc::new(Counting::default());
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_hubspot(reader.clone())
    .with_crm_writer(crm_for(team, &[&owner]))
    .with_import_rollout(Arc::new(Without(ImportSource::Hubspot)))
    .scoped(ImportSource::Hubspot);

    let refused = service
        .prepare_workspace_import(&owner, ImportSource::Hubspot, None, Duration::from_secs(5))
        .await
        .unwrap_err();
    // A run planned before the rollout went off, adopted now.
    let adopted = service
        .plan(
            &owner,
            import_notion::domain::model::ImportScope::Everything,
            NotionSharing::Team,
            &JobControl::new(CancellationToken::new()),
        )
        .await
        .unwrap_err();

    assert!(
        matches!(refused, ImportError::NotRolledOut(ImportSource::Hubspot)),
        "{refused:?}"
    );
    assert!(
        matches!(adopted, ImportError::NotRolledOut(ImportSource::Hubspot)),
        "{adopted:?}"
    );
    assert_eq!(reader.reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        refused.to_string(),
        "the HubSpot import is not turned on for this account yet"
    );
}
