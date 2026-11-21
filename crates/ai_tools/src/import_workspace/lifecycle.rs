//! Host adapter for physical app-entity lifecycle facts. No viewer is involved.
use databases::domain::{models::DatabaseId, ports::DatabaseLifecycleReads};
use documents::domain::ports::DocumentLifecycleReads;
use import::domain::ports::ImportedTarget;
use initiative::domain::{models::InitiativeId, ports::InitiativeLifecycleReads};
use projects::domain::ports::ProjectLifecycleReads;

#[cfg(test)]
mod test;

pub(super) async fn exists<
    D: DocumentLifecycleReads,
    P: ProjectLifecycleReads,
    B: DatabaseLifecycleReads,
    I: InitiativeLifecycleReads,
>(
    documents: &D,
    projects: &P,
    databases: &B,
    initiatives: &I,
    target: ImportedTarget,
) -> anyhow::Result<bool> {
    match target {
        ImportedTarget::Document(id) => documents.document_is_live(id).await,
        ImportedTarget::Folder(id) => projects.project_is_live(id).await,
        ImportedTarget::Database(id) => Ok(databases
            .database_is_live(DatabaseId::from_uuid(id))
            .await?),
        ImportedTarget::Initiative(id) => Ok(initiatives
            .initiative_is_live(InitiativeId::from_uuid(id))
            .await?),
    }
}
