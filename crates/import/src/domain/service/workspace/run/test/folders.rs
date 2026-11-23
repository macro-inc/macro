use super::*;
use crate::domain::ports::ImportVisibility;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn page_folders_follow_all_shared_and_mixed_reviewed_contents(pool: PgPool) {
    for (child_shared, expected_folder) in [
        (true, ImportVisibility::Shared),
        (false, ImportVisibility::Personal),
    ] {
        let owner = teammate(&pool, &format!("folder-{child_shared}"), Uuid::now_v7()).await;
        let parent = planned_page('e', "Parent", true);
        let mut child = planned_page('f', "Child", child_shared);
        child.parent_foreign_id = Some(page_id('e').as_str().to_string());
        let (review, _) = approved(&pool, &owner, &[parent, child]).await;
        let tracker = TaskTracker::new();
        let service = service(
            &pool,
            Writer::default(),
            CancellationToken::new(),
            tracker.clone(),
        );
        planned(&service.repo, &owner).await;
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        assert!(
            service
                .creator
                .folder_visibilities
                .lock()
                .unwrap()
                .contains(&("Parent".to_string(), expected_folder))
        );
        let folder_shared = service
            .creator
            .shares
            .lock()
            .unwrap()
            .iter()
            .any(|share| matches!(share, SharedEntity::Folder(_)));
        assert_eq!(folder_shared, child_shared);
    }
}

async fn write_plan_rows(service: &Service, owner: &MacroUserIdStr<'static>, rows: &[PlanRow]) {
    use crate::domain::service::notion_workspace::write::WriteItem;
    let rows = service
        .repo
        .replace_plan(owner, ImportSource::Notion, rows)
        .await
        .unwrap();
    let all: Vec<_> = rows.iter().filter_map(WriteItem::from_entity).collect();
    let pending: Vec<_> = all.iter().filter(|item| item.writes()).cloned().collect();
    let pending_ids: Vec<_> = pending.iter().map(|item| item.import_id).collect();
    service
        .repo
        .mark_importing(owner, &pending_ids)
        .await
        .unwrap();
    let set = WriteSet {
        review_id: Uuid::now_v7(),
        pending,
        all,
    };
    assert_eq!(
        service
            .try_write_plan(owner, &set, &JobControl::new(CancellationToken::new()))
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn later_shared_plans_never_share_earlier_personal_folders(pool: PgPool) {
    reverse_leak_case(&pool, false).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn later_shared_plans_never_share_the_personal_mirror(pool: PgPool) {
    reverse_leak_case(&pool, true).await;
}

async fn reverse_leak_case(pool: &PgPool, mirrored: bool) {
    use crate::domain::models::WrittenKind;
    use crate::domain::ports::{NotionRunRepo, WrittenObjects};
    {
        let owner = teammate(pool, &format!("reverse-{mirrored}"), Uuid::now_v7()).await;
        let service = service(
            pool,
            Writer::default(),
            CancellationToken::new(),
            TaskTracker::new(),
        );
        service
            .repo
            .start_run(&owner, ImportSource::Notion, &[])
            .await
            .unwrap();
        if mirrored {
            let root = service
                .creator
                .create_folder(&owner, "Notion", None, ImportVisibility::Shared)
                .await
                .unwrap();
            service.repo.set_root_folder(&owner, root).await.unwrap();
            service.creator.grants.lock().unwrap().insert(root);
        }
        let mut parent = planned_page('e', "Parent", false);
        parent.metadata["plan"]["decision"] = "skip".into();
        let mut private = planned_page('f', "Earlier personal child", false);
        private.parent_foreign_id = Some(page_id('e').as_str().to_string());
        write_plan_rows(&service, &owner, &[parent, private]).await;
        let parent = service
            .repo
            .list(&owner, Some(ImportSource::Notion), None)
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.foreign_id == page_id('e').as_str())
            .unwrap();
        let old = service
            .repo
            .written(&owner, &[parent.id])
            .await
            .unwrap()
            .into_iter()
            .find(|marker| marker.kind == WrittenKind::Folder && marker.object.is_empty())
            .unwrap()
            .macro_id;
        assert!(
            service
                .creator
                .document_folders
                .lock()
                .unwrap()
                .iter()
                .any(|(_, folder)| *folder == Some(old))
        );
        let mut shared_child = planned_page('a', "New shared child", true);
        shared_child.parent_foreign_id = Some(page_id('e').as_str().to_string());
        write_plan_rows(
            &service,
            &owner,
            &[planned_page('e', "Parent", true), shared_child],
        )
        .await;
        assert!(
            !service
                .creator
                .shares
                .lock()
                .unwrap()
                .iter()
                .any(|share| matches!(share, SharedEntity::Folder(id) if *id == old)),
            "later shared plan exposed earlier personal contents, mirrored={mirrored}"
        );
        assert!(
            service
                .notion_import_report(&owner)
                .await
                .unwrap()
                .warnings
                .iter()
                .any(|warning| warning.contains("created a separate shared folder"))
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn write_plan_routes_personal_pages_bodies_and_tasks_out_of_shared_folders(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use crate::domain::ports::{NotionRunRepo, WrittenObjects};
    let owner = teammate(&pool, "private-routing", Uuid::now_v7()).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let root = service
        .creator
        .create_folder(&owner, "Notion", None, ImportVisibility::Shared)
        .await
        .unwrap();
    service.repo.set_root_folder(&owner, root).await.unwrap();
    service.creator.grants.lock().unwrap().insert(root);
    let mut parent = planned_page('e', "Parent", false);
    parent.metadata["plan"]["decision"] = "skip".into();
    let mut rows = vec![parent];
    for (hex, decision, kind) in [
        ('f', "copy", ImportKind::Page),
        ('a', "copy", ImportKind::DataSource),
        ('b', "tasks", ImportKind::DataSource),
    ] {
        let mut row = planned_page(hex, &format!("Items {hex}"), false);
        row.parent_foreign_id = Some(page_id('e').as_str().to_string());
        row.kind = kind;
        row.metadata["plan"]["decision"] = decision.into();
        rows.push(row);
    }
    let staged = service
        .repo
        .replace_plan(&owner, ImportSource::Notion, &rows)
        .await
        .unwrap();
    for row in &staged {
        let kind = match row.foreign_id.chars().next().unwrap() {
            'e' => WrittenKind::Folder,
            'a' => WrittenKind::BodiesFolder,
            'b' => WrittenKind::TasksFolder,
            _ => continue,
        };
        let old = service
            .creator
            .create_folder(&owner, "Old folder", Some(root), ImportVisibility::Shared)
            .await
            .unwrap();
        service
            .repo
            .record_written(&owner, &[WrittenObject::own(row.id, kind, old)])
            .await
            .unwrap();
    }
    write_plan_rows(&service, &owner, &rows).await;
    let destinations: Vec<_> = service
        .creator
        .document_folders
        .lock()
        .unwrap()
        .iter()
        .map(|(_, folder)| *folder)
        .chain(service.creator.task_folders.lock().unwrap().iter().copied())
        .collect();
    assert_eq!(
        destinations.len(),
        3,
        "page, row body and task must all be created"
    );
    for folder in destinations {
        assert!(
            !service
                .creator
                .folder_has_explicit_grant(&owner, folder.unwrap())
                .await
                .unwrap(),
            "personal output was filed under an explicit grant"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_existing_team_edit_folder_is_reused_without_another_grant(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use crate::domain::ports::WrittenObjects;
    let owner = teammate(&pool, "legacy-shared", Uuid::now_v7()).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let folder = service
        .creator
        .create_folder(&owner, "Parent", None, ImportVisibility::Shared)
        .await
        .unwrap();
    service
        .creator
        .share_with_team(&owner, SharedEntity::Folder(folder))
        .await
        .unwrap();
    let mut child = planned_page('f', "Shared child", true);
    child.parent_foreign_id = Some(page_id('e').as_str().to_string());
    let rows = vec![planned_page('e', "Parent", true), child];
    let staged = service
        .repo
        .replace_plan(&owner, ImportSource::Notion, &rows)
        .await
        .unwrap();
    service
        .repo
        .record_written(
            &owner,
            &[WrittenObject::own(
                staged[0].id,
                WrittenKind::Folder,
                folder,
            )],
        )
        .await
        .unwrap();
    write_plan_rows(&service, &owner, &rows).await;
    assert_eq!(
        service
            .creator
            .folder_records
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, name, _)| name == "Parent")
            .count(),
        1
    );
    assert_eq!(
        service
            .creator
            .shares
            .lock()
            .unwrap()
            .iter()
            .filter(|share| matches!(share, SharedEntity::Folder(id) if *id == folder))
            .count(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_personal_paths_have_one_mirror_root_and_folder_chain(pool: PgPool) {
    let owner = user("parallel-mirror");
    let service = service(
        &pool,
        Writer {
            folder_delay: Some(std::time::Duration::from_millis(20)),
            ..Default::default()
        },
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let path = vec!["Team wiki".into(), "Notes".into()];
    let results =
        futures::future::join_all((0..4).map(|_| service.personal_mirror_folder(&owner, &path)))
            .await;
    let folders: Vec<_> = results.into_iter().map(Result::unwrap).collect();
    assert!(folders.iter().all(|folder| *folder == folders[0]));
    assert_eq!(
        service.creator.folder_records.lock().unwrap().len(),
        3,
        "one root and two path components"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unshared_marked_folder_is_preserved_and_its_replacement_is_reused(pool: PgPool) {
    use crate::domain::models::WrittenKind;
    use crate::domain::ports::WrittenObjects;
    let owner = teammate(&pool, "unshared-folder", Uuid::now_v7()).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut parent = planned_page('e', "Parent", true);
    parent.metadata["plan"]["decision"] = "skip".into();
    let mut child = planned_page('f', "First shared child", true);
    child.parent_foreign_id = Some(page_id('e').as_str().to_string());
    write_plan_rows(&service, &owner, &[parent.clone(), child]).await;
    let parent_row = service
        .repo
        .list(&owner, Some(ImportSource::Notion), None)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.foreign_id == page_id('e').as_str())
        .unwrap();
    let old = service
        .repo
        .written(&owner, &[parent_row.id])
        .await
        .unwrap()
        .into_iter()
        .find(|marker| marker.kind == WrittenKind::Folder && marker.object == "shared")
        .unwrap()
        .macro_id;
    service
        .creator
        .shares
        .lock()
        .unwrap()
        .retain(|share| !matches!(share, SharedEntity::Folder(id) if *id == old));
    service.creator.grants.lock().unwrap().remove(&old);
    for hex in ['a', 'b'] {
        let mut child = planned_page(hex, "Next shared child", true);
        child.parent_foreign_id = Some(page_id('e').as_str().to_string());
        write_plan_rows(&service, &owner, &[parent.clone(), child]).await;
        assert!(
            !service
                .creator
                .shares
                .lock()
                .unwrap()
                .iter()
                .any(|share| matches!(share, SharedEntity::Folder(id) if *id == old)),
            "the user's removed grant was restored"
        );
    }
    let saved = service
        .repo
        .get(&owner, parent_row.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        saved.metadata["separateFolder"]["reason"],
        "sharing_removed"
    );
    assert_eq!(
        service
            .creator
            .folder_records
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, name, _)| name == "Parent")
            .count(),
        2,
        "one replacement, then reuse"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teamless_shared_verdict_still_reaches_each_notion_writer(pool: PgPool) {
    let owner = user("teamless-notion");
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut rows = vec![planned_page('f', "Shared page", true)];
    for (hex, decision) in [('a', "copy"), ('b', "tasks")] {
        let mut row = planned_page(hex, "Shared source", true);
        row.kind = ImportKind::DataSource;
        row.metadata["plan"]["decision"] = decision.into();
        rows.push(row);
    }
    write_plan_rows(&service, &owner, &rows).await;
    let visibilities = service.creator.visibilities.lock().unwrap();
    assert_eq!(visibilities.len(), 3);
    assert!(
        visibilities
            .iter()
            .all(|(_, visibility)| *visibility == ImportVisibility::Shared)
    );
    assert!(service.creator.shares.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_notion_re_review_clears_only_its_own_task_notices(pool: PgPool) {
    use crate::domain::{
        models::{Initiator, WrittenKind, WrittenObject},
        ports::{TaskImportNoticeReason, WrittenObjects},
    };
    let owner = teammate(&pool, "shared-notice-retry", Uuid::now_v7()).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    );
    service
        .repo
        .start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let mut planned = planned_page('a', "Tasks", false);
    planned.kind = ImportKind::DataSource;
    planned.metadata["plan"]["decision"] = "tasks".into();
    let source = service
        .repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            page_id('a').as_str(),
            &planned.metadata,
        )
        .await
        .unwrap()
        .unwrap();
    let unrelated = service
        .repo
        .upsert_staged(
            &owner,
            ImportSource::Notion,
            ImportKind::DataSource,
            Initiator::Manual,
            page_id('b').as_str(),
            &planned.metadata,
        )
        .await
        .unwrap()
        .unwrap();
    let task = Uuid::now_v7();
    let other_task = Uuid::now_v7();
    service
        .repo
        .record_written(
            &owner,
            &[WrittenObject::for_row(
                source.id,
                WrittenKind::Task,
                &page_id('f'),
                task,
            )],
        )
        .await
        .unwrap();
    service
        .repo
        .record_written(
            &owner,
            &[WrittenObject::for_row(
                unrelated.id,
                WrittenKind::Task,
                &page_id('f'),
                other_task,
            )],
        )
        .await
        .unwrap();
    for (row, notice_task) in [(&source, task), (&unrelated, other_task)] {
        service
            .repo
            .record_task_notice(
                &owner,
                row.id,
                notice_task,
                TaskImportNoticeReason::PersonalAssigneeOmitted,
            )
            .await
            .unwrap();
    }
    planned.metadata["plan"]["shared"] = true.into();
    write_plan_rows(&service, &owner, &[planned]).await;
    assert!(
        service
            .repo
            .task_notice_counts(&owner, &[source.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        service
            .repo
            .task_notice_counts(&owner, &[unrelated.id])
            .await
            .unwrap()[0]
            .count,
        1
    );
    assert!(
        service
            .repo
            .written(&owner, &[source.id])
            .await
            .unwrap()
            .iter()
            .any(|marker| marker.kind == WrittenKind::Task && marker.macro_id == task)
    );
}
