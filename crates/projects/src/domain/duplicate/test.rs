use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use futures::channel::oneshot;

use entity_access_management::domain::models::EntityAccessManagementError;
use entity_access_management::domain::ports::EntityAccessManagementService;
use entity_registry::{BotFacts, EntityRegistryResult, OwnerGrantPolicy};
use entity_registry_db_utils::OwnedEntityRegistrar;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::{
    ProjectSearchIndexer, ShaCounterPort, UnavailableBulkUploadRequestPort,
    UnavailableProjectUploadUrlPort,
};
use crate::domain::service::ProjectServiceImpl;
use crate::outbound::PgProjectRepo;

const OWNER: &str = "macro|owner@test.com";
const ROOT_ID: &str = "10000000-0000-0000-0000-000000000001";
const FIRST_CHILD_ID: &str = "10000000-0000-0000-0000-000000000002";
const DOCUMENT_ID: &str = "20000000-0000-0000-0000-000000000001";
const CHAT_ID: &str = "30000000-0000-0000-0000-000000000001";

#[derive(Clone)]
struct NoBots;

impl BotFacts for NoBots {
    async fn sponsor(&self, _bot: bot_id::BotId) -> EntityRegistryResult<Option<Owner>> {
        Ok(None)
    }
}

/// Accepts the side effects of creating and purging projects.
#[derive(Clone, Copy)]
struct AcceptAll;

impl ShaCounterPort for AcceptAll {
    async fn decrement_counts(&self, _sha_counts: &[(String, i64)]) -> anyhow::Result<()> {
        Ok(())
    }
}

impl ProjectSearchIndexer for AcceptAll {
    async fn remove_documents(&self, _document_ids: Vec<String>) -> anyhow::Result<()> {
        Ok(())
    }

    async fn enqueue_document_deletes(
        &self,
        _documents: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

impl EntityAccessManagementService for AcceptAll {
    async fn add_entity_to_project(
        &self,
        _entity_id: &Uuid,
        _entity_type: EntityType,
        _project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        Ok(())
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &Uuid,
        _entity_type: EntityType,
        _old_project_id: &Uuid,
    ) -> Result<(), EntityAccessManagementError> {
        Ok(())
    }

    async fn move_project(
        &self,
        _project_id: &Uuid,
        _old_project_id: Option<&Uuid>,
        _new_project_id: Option<&Uuid>,
    ) -> Result<(), EntityAccessManagementError> {
        Ok(())
    }
}

type TestProjects = ProjectServiceImpl<
    PgProjectRepo<NoBots>,
    UnavailableProjectUploadUrlPort,
    UnavailableBulkUploadRequestPort,
    AcceptAll,
    AcceptAll,
    AcceptAll,
    NoopMacroEventBroker,
>;

fn projects(pool: PgPool) -> Arc<TestProjects> {
    Arc::new(ProjectServiceImpl::new(
        PgProjectRepo::new(
            pool,
            OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
        ),
        UnavailableProjectUploadUrlPort,
        UnavailableBulkUploadRequestPort,
        AcceptAll,
        AcceptAll,
        AcceptAll,
        None,
        NoopMacroEventBroker,
    ))
}

/// Copies documents and chats as rows in the target folder, the way their
/// domains leave a filed copy, and records what it copied.
#[derive(Clone)]
struct FakeContents {
    pool: PgPool,
    hidden: HashSet<&'static str>,
    can_add_to_parent: bool,
    /// The source whose copy fails, once another copy has finished.
    failing: Option<&'static str>,
    first_copy_done: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    first_copy_waiter: Arc<Mutex<Option<oneshot::Receiver<()>>>>,
    copied: Arc<Mutex<Vec<(String, String, String)>>>,
}

impl FakeContents {
    fn new(pool: PgPool) -> Self {
        let (done, waiter) = oneshot::channel();
        Self {
            pool,
            hidden: HashSet::new(),
            can_add_to_parent: true,
            failing: None,
            first_copy_done: Arc::new(Mutex::new(Some(done))),
            first_copy_waiter: Arc::new(Mutex::new(Some(waiter))),
            copied: Arc::default(),
        }
    }

    /// `(source id, copy's folder, name)` per copy, sorted.
    fn copied(&self) -> Vec<(String, String, String)> {
        let mut copied = self.copied.lock().unwrap().clone();
        copied.sort();
        copied
    }
}

impl ProjectContentCopier for FakeContents {
    async fn view_receipt(
        &self,
        entity: &Entity<'static>,
    ) -> Result<Option<EntityAccessReceipt<ViewAccessLevel>>, EntityMutationErrorCode> {
        if self.hidden.contains(entity.entity_id.as_ref()) {
            return Ok(None);
        }
        Ok(Some(
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                MacroUserIdStr::try_from(OWNER.to_string()).unwrap(),
                &entity.entity_id,
                entity.entity_type,
            ),
        ))
    }

    async fn can_add_to_project(&self, _project_id: &str) -> Result<bool, EntityMutationErrorCode> {
        Ok(self.can_add_to_parent)
    }

    async fn copy_into_project(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        name: String,
        project_id: &str,
    ) -> Result<Entity<'static>, EntityMutationErrorCode> {
        let source = receipt.entity();
        if self.failing == Some(source.entity_id.as_str()) {
            let waiter = self.first_copy_waiter.lock().unwrap().take();
            if let Some(waiter) = waiter {
                waiter.await.unwrap();
            }
            return Err(EntityMutationErrorCode::internal(rootcause::report!(
                "copy failed".to_string()
            )));
        }
        let copy_id = Uuid::now_v7();
        match source.entity_type {
            EntityType::Document => {
                sqlx::query!(
                    r#"INSERT INTO "Document" (id, name, owner, "projectId") VALUES ($1, $2, $3, $4)"#,
                    copy_id.to_string(),
                    name,
                    OWNER,
                    project_id,
                )
                .execute(&self.pool)
                .await
                .unwrap();
            }
            _ => {
                sqlx::query!(
                    r#"INSERT INTO "Chat" (id, name, "userId", "projectId") VALUES ($1, $2, $3, $4)"#,
                    copy_id.to_string(),
                    name,
                    OWNER,
                    project_id,
                )
                .execute(&self.pool)
                .await
                .unwrap();
            }
        }
        sqlx::query!(
            r#"
            INSERT INTO entity (id, entity_type, owner_type, owner_id)
            VALUES ($1, $2, 'user', $3)
            "#,
            copy_id,
            source.entity_type.to_string(),
            OWNER,
        )
        .execute(&self.pool)
        .await
        .unwrap();
        self.copied
            .lock()
            .unwrap()
            .push((source.entity_id.clone(), project_id.to_string(), name));
        let done = self.first_copy_done.lock().unwrap().take();
        if let Some(done) = done {
            let _ = done.send(());
        }
        Ok(source.entity_type.with_entity_string(copy_id.to_string()))
    }
}

async fn duplicate(
    duplicator: &ProjectDuplicator<TestProjects, FakeContents>,
    project_id: &str,
    display_name: Option<&str>,
) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
    let owner = MacroUserIdStr::try_from(OWNER.to_string()).unwrap();
    duplicator
        .duplicate_entity(
            EntityType::Project.with_entity_string(project_id.to_string()),
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                owner.clone(),
                project_id,
                EntityType::Project,
            ),
            owner,
            display_name.map(str::to_string),
        )
        .await
}

/// The live folders directly inside `parent_id` (or at the top level), as
/// `(id, name, owner)`.
async fn child_folders(pool: &PgPool, parent_id: Option<&str>) -> Vec<(String, String, String)> {
    sqlx::query!(
        r#"
        SELECT id, name, "userId" AS user_id
        FROM "Project"
        WHERE "parentId" IS NOT DISTINCT FROM $1 AND "deletedAt" IS NULL
        ORDER BY name
        "#,
        parent_id,
    )
    .map(|row| (row.id, row.name, row.user_id))
    .fetch_all(pool)
    .await
    .unwrap()
}

fn copy_id(effects: &[EntityMutationEffect]) -> String {
    match effects {
        [EntityMutationEffect::Updated(copy)] if copy.entity_type == EntityType::Project => {
            copy.entity_id.to_string()
        }
        other => panic!("expected one updated project, got {other:?}"),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn copies_subfolders_documents_and_chats_into_a_new_tree(pool: PgPool) {
    let contents = FakeContents::new(pool.clone());
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let effects = duplicate(&duplicator, ROOT_ID, None).await.unwrap();

    let copy = copy_id(&effects);
    let top_level = child_folders(&pool, None).await;
    assert!(top_level.contains(&(copy.clone(), "Root copy".to_string(), OWNER.to_string())));
    let first_child = child_folders(&pool, Some(&copy)).await;
    assert_eq!(first_child.len(), 1);
    assert_eq!(first_child[0].1, "First child");
    assert_eq!(first_child[0].2, OWNER);
    let grandchild = child_folders(&pool, Some(&first_child[0].0)).await;
    assert_eq!(grandchild.len(), 1);
    assert_eq!(grandchild[0].1, "Grandchild");
    assert!(
        child_folders(&pool, Some(&grandchild[0].0))
            .await
            .is_empty()
    );
    assert_eq!(
        contents.copied(),
        vec![
            (
                DOCUMENT_ID.to_string(),
                copy.clone(),
                "Document".to_string()
            ),
            (CHAT_ID.to_string(), copy.clone(), "Chat".to_string()),
        ]
    );
    // The source tree is untouched.
    assert_eq!(child_folders(&pool, Some(ROOT_ID)).await.len(), 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn places_the_copy_beside_the_source_only_when_the_user_can_add_there(pool: PgPool) {
    let beside = ProjectDuplicator::new(projects(pool.clone()), FakeContents::new(pool.clone()));
    let effects = duplicate(&beside, FIRST_CHILD_ID, Some("Renamed"))
        .await
        .unwrap();
    let copy = copy_id(&effects);
    let in_root = child_folders(&pool, Some(ROOT_ID)).await;
    assert!(in_root.contains(&(copy.clone(), "Renamed".to_string(), OWNER.to_string())));
    assert_eq!(child_folders(&pool, Some(&copy)).await[0].1, "Grandchild");

    let mut no_access_to_parent = FakeContents::new(pool.clone());
    no_access_to_parent.can_add_to_parent = false;
    let top_level = ProjectDuplicator::new(projects(pool.clone()), no_access_to_parent);
    let effects = duplicate(&top_level, FIRST_CHILD_ID, None).await.unwrap();
    let copy = copy_id(&effects);
    assert!(child_folders(&pool, None).await.contains(&(
        copy,
        "First child copy".to_string(),
        OWNER.to_string()
    )));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn leaves_email_threads_filed_in_the_source(pool: PgPool) {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, 'fusionauth-owner', 'owner@test.com', 'GMAIL')
        "#,
        link_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id, project_id) VALUES ($1, $2, $3)"#,
        thread_id,
        link_id,
        ROOT_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let contents = FakeContents::new(pool.clone());
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let effects = duplicate(&duplicator, ROOT_ID, None).await.unwrap();

    let copy = copy_id(&effects);
    let thread_folders = sqlx::query_scalar!(
        r#"SELECT project_id FROM email_threads WHERE link_id = $1"#,
        link_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(thread_folders, vec![Some(ROOT_ID.to_string())]);
    assert!(
        contents
            .copied()
            .iter()
            .all(|(source, folder, _)| *source != thread_id.to_string() && *folder == copy)
    );
    assert_eq!(contents.copied().len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn skips_entries_the_user_cannot_view_with_their_contents(pool: PgPool) {
    let mut contents = FakeContents::new(pool.clone());
    contents.hidden = HashSet::from([FIRST_CHILD_ID, DOCUMENT_ID]);
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let effects = duplicate(&duplicator, ROOT_ID, None).await.unwrap();

    let copy = copy_id(&effects);
    assert!(child_folders(&pool, Some(&copy)).await.is_empty());
    assert_eq!(
        contents.copied(),
        vec![(CHAT_ID.to_string(), copy, "Chat".to_string())]
    );
    let grandchildren = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE name = 'Grandchild'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(grandchildren, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn refuses_a_tree_over_the_limit_without_creating_anything(pool: PgPool) {
    // Two subfolders, a document, and a chat are already in the tree.
    sqlx::query!(
        r#"
        INSERT INTO "Document" (id, name, owner, "projectId")
        SELECT gen_random_uuid()::text, 'Bulk ' || n, $1, $2
        FROM generate_series(1, 97) AS n
        "#,
        OWNER,
        FIRST_CHILD_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let projects_before = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    let contents = FakeContents::new(pool.clone());
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let error = duplicate(&duplicator, ROOT_ID, None).await.unwrap_err();

    assert!(matches!(error, EntityMutationErrorCode::InvalidInput(_)));
    let projects_after = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(projects_after, projects_before);
    assert!(contents.copied().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn duplicates_a_tree_at_the_limit(pool: PgPool) {
    sqlx::query!(
        r#"
        INSERT INTO "Document" (id, name, owner, "projectId")
        SELECT gen_random_uuid()::text, 'Bulk ' || n, $1, $2
        FROM generate_series(1, 96) AS n
        "#,
        OWNER,
        FIRST_CHILD_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let contents = FakeContents::new(pool.clone());
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    duplicate(&duplicator, ROOT_ID, None).await.unwrap();

    assert_eq!(contents.copied().len(), 98);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn a_failed_copy_discards_everything_already_copied(pool: PgPool) {
    let projects_before = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut contents = FakeContents::new(pool.clone());
    contents.failing = Some(CHAT_ID);
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let error = duplicate(&duplicator, ROOT_ID, None).await.unwrap_err();

    assert!(matches!(error, EntityMutationErrorCode::Internal(_)));
    // The document copied before the chat failed went with the folder copy.
    let copied = contents.copied();
    assert_eq!(copied.len(), 1);
    assert_eq!(copied[0].0, DOCUMENT_ID);
    let document_copy_rows = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Document" WHERE name = 'Document'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(document_copy_rows, 1);
    let projects_after = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM "Project""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(projects_after, projects_before);
    let copy_entities = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM entity
        WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
        "#,
        OWNER,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(copy_entities, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn refuses_a_deleted_project(pool: PgPool) {
    let contents = FakeContents::new(pool.clone());
    let duplicator = ProjectDuplicator::new(projects(pool.clone()), contents.clone());

    let error = duplicate(&duplicator, "10000000-0000-0000-0000-000000000009", None)
        .await
        .unwrap_err();

    assert!(matches!(error, EntityMutationErrorCode::InvalidInput(_)));
    assert!(contents.copied().is_empty());
}
