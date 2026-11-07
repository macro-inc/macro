//! Exercise the actual host dispatch with owning PostgreSQL lifecycle readers.
use super::*;
use entity_registry::{BotFacts, EntityRegistryResult, OwnerGrantPolicy};
use entity_registry_db_utils::OwnedEntityRegistrar;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_owner::Owner;
use sqlx::PgPool;
use uuid::Uuid;

struct NoBots;
impl BotFacts for NoBots {
    async fn sponsor(&self, _: bot_id::BotId) -> EntityRegistryResult<Option<Owner>> {
        Ok(None)
    }
}

struct UnrelatedFacts;
impl DatabaseLifecycleReads for UnrelatedFacts {
    async fn database_is_live(
        &self,
        _: DatabaseId,
    ) -> Result<bool, databases::domain::models::DatabaseError> {
        Ok(false)
    }
}
impl InitiativeLifecycleReads for UnrelatedFacts {
    async fn initiative_is_live(
        &self,
        _: InitiativeId,
    ) -> Result<bool, initiative::domain::models::InitiativeError> {
        Ok(false)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn host_lifecycle_reads_ignore_permissions_and_follow_trash_restore_and_hard_delete(
    pool: PgPool,
) {
    let macro_user = Uuid::now_v7();
    let document = Uuid::now_v7();
    let folder = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,'adapter-lifecycle','adapter-lifecycle@example.com','adapter-lifecycle')", macro_user).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ('macro|adapter-lifecycle@example.com','adapter-lifecycle@example.com',$1)"#, macro_user).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType") VALUES ($1,'Live copy','macro|adapter-lifecycle@example.com','md')"#, document.to_string()).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "Project" (id,name,"userId") VALUES ($1,'Live folder','macro|adapter-lifecycle@example.com')"#, folder.to_string()).execute(&pool).await.unwrap();
    assert!(!sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM entity_access WHERE entity_id = ANY($1::uuid[])) AS "granted!""#, &[document, folder]).fetch_one(&pool).await.unwrap());
    let documents = documents::outbound::pg_document_repo::PgDocumentRepo::new(
        pool.clone(),
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
    );
    let projects = projects::outbound::pg_project_repo::PgProjectRepo::new(
        pool.clone(),
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
    );
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Document(document)
        )
        .await
        .unwrap()
    );
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Folder(folder)
        )
        .await
        .unwrap()
    );
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id=$1"#,
        document.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NOW() WHERE id=$1"#,
        folder.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Document(document)
        )
        .await
        .unwrap()
    );
    assert!(
        !exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Folder(folder)
        )
        .await
        .unwrap()
    );
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NULL WHERE id=$1"#,
        document.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NULL WHERE id=$1"#,
        folder.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Document(document)
        )
        .await
        .unwrap()
    );
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Folder(folder)
        )
        .await
        .unwrap()
    );
    sqlx::query!(
        r#"DELETE FROM "Document" WHERE id=$1"#,
        document.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(r#"DELETE FROM "Project" WHERE id=$1"#, folder.to_string())
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        !exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Document(document)
        )
        .await
        .unwrap()
    );
    assert!(
        !exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Folder(folder)
        )
        .await
        .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn host_lifecycle_reads_propagate_database_failures_instead_of_reporting_deletion(
    pool: PgPool,
) {
    let documents = documents::outbound::pg_document_repo::PgDocumentRepo::new(
        pool.clone(),
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
    );
    let projects = projects::outbound::pg_project_repo::PgProjectRepo::new(
        pool.clone(),
        OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
    );
    pool.close().await;
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Document(Uuid::now_v7())
        )
        .await
        .is_err()
    );
    assert!(
        exists(
            &documents,
            &projects,
            &UnrelatedFacts,
            &UnrelatedFacts,
            ImportedTarget::Folder(Uuid::now_v7())
        )
        .await
        .is_err()
    );
}
