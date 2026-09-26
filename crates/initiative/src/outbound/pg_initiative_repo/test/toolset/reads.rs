use super::*;
use crate::inbound::toolset::{ListInitiatives, ReadInitiative};
use entity_access::domain::models::EntityPermission;

#[derive(Debug)]
struct VisibleResources {
    hidden_task: String,
}

impl InitiativeResources for VisibleResources {
    fn initialize(&self, _: InitiativeId) -> ResourceFuture<'_, ()> {
        panic!("read-only fixture")
    }
    fn purge(&self, _: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        panic!("read-only fixture")
    }
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        Box::pin(async move {
            if entity.entity_id == self.hidden_task {
                return Ok(None);
            }
            Ok(Some(EntityAccessReceipt::try_new(
                auth,
                entity,
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                },
            )?))
        })
    }
    fn properties(
        &self,
        _: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        Box::pin(async { Ok(HashMap::new()) })
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tool_cursors_enumerate_projects_and_more_than_two_hundred_visible_tasks(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
    let mut projects = Vec::new();
    for name in ["Launch one", "Launch two"] {
        projects.push(
            repo.create(
                create_args(&pool, OWNER, name, &[]).await?,
                share_off(),
                TeamShareCreation::Unshared,
            )
            .await?,
        );
    }
    let mut task_ids = Vec::new();
    for _ in 0..202 {
        let id = Uuid::now_v7().to_string();
        insert_document(&pool, &id, OWNER, true).await?;
        task_ids.push(id);
    }
    repo.assign_tasks(projects[0].id, task_ids.clone()).await?;
    let hidden_task = task_ids.remove(100);
    let context = context_with_resources(
        pool,
        Arc::new(Events::default()),
        Arc::new(VisibleResources {
            hidden_task: hidden_task.clone(),
        }),
    );
    let mut list: ListInitiatives =
        serde_json::from_value(serde_json::json!({"query": "Launch", "limit": 1}))?;
    let mut listed = Vec::new();
    loop {
        let page = list
            .call(
                ServiceContext(context.clone()),
                RequestContext::new(user(OWNER)),
            )
            .await
            .map_err(|error| error.internal_error)?;
        assert_eq!(page.projects.len(), 1);
        assert_eq!(page.truncated, page.next_cursor.is_some());
        listed.extend(
            page.projects
                .into_iter()
                .map(|project| project.initiative_id),
        );
        list.cursor = page.next_cursor;
        if list.cursor.is_none() {
            break;
        }
        assert!(listed.len() < 3, "collection cursor must advance");
    }
    listed.sort();
    let mut expected: Vec<_> = projects
        .iter()
        .map(|project| project.id.as_uuid())
        .collect();
    expected.sort();
    assert_eq!(listed, expected);

    let mut read = ReadInitiative {
        initiative_id: projects[0].id.as_uuid(),
        task_cursor: None,
        task_limit: Some(100),
    };
    let mut found = Vec::new();
    let mut page_count = 0;
    loop {
        let page = read
            .call(
                ServiceContext(context.clone()),
                RequestContext::new(user(OWNER)),
            )
            .await
            .map_err(|error| error.internal_error)?;
        assert_eq!(page.project.task_count, 201);
        assert!(page.project.task_ids.len() <= 100);
        assert!(!page.project.task_ids.contains(&hidden_task));
        assert_eq!(
            page.project.tasks_truncated,
            page.next_task_cursor.is_some()
        );
        found.extend(page.project.task_ids);
        page_count += 1;
        read.task_cursor = page.next_task_cursor;
        if read.task_cursor.is_none() {
            break;
        }
        assert!(page_count < 4, "task cursor must advance");
    }
    assert_eq!(page_count, 3);
    task_ids.sort();
    assert_eq!(found, task_ids);
    Ok(())
}
