//! Deferred links use completed writes, including earlier reviews, and never patch an edited body.

use super::*;
use crate::domain::ports::{NotionLinkDestination, NotionLinkReference};

pub(super) fn reference(id: char) -> NotionLinkReference {
    NotionLinkReference {
        id: page_id(id),
        view_id: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deferred_links_follow_forward_cyclic_and_prior_writes_in_the_same_audience(pool: PgPool) {
    let team = Uuid::now_v7();
    let user = teammate(&pool, "link-author", team).await;
    let other_team = Uuid::now_v7();
    let other = teammate(&pool, "link-outside-team", other_team).await;
    let repo = PgImportRepo::new(pool.clone());

    let (_, outsiders) = approved(&pool, &other, &[planned_page('d', "Other team", true)]).await;
    let outside_document = write::document_id(outsiders[0]);
    repo.claim_importing(&other, &outsiders, &outsiders, Some(other_team))
        .await
        .unwrap();
    repo.mark_imported(
        &other,
        outsiders[0],
        &outside_document.to_string(),
        "md",
        None,
    )
    .await
    .unwrap();

    let (_, earlier) = approved(
        &pool,
        &user,
        &[
            planned_page('a', "Prior page", false),
            planned_page('b', "Inaccessible page", false),
            planned_page('c', "Failed page", false),
            planned_page('9', "Shared page", true),
        ],
    )
    .await;
    let prior_document = write::document_id(earlier[0]);
    let inaccessible = write::document_id(earlier[1]);
    repo.claim_importing(&user, &earlier, &[earlier[3]], Some(team))
        .await
        .unwrap();
    for index in [0, 1, 3] {
        repo.mark_imported(
            &user,
            earlier[index],
            &write::document_id(earlier[index]).to_string(),
            "md",
            None,
        )
        .await
        .unwrap();
    }
    repo.mark_import_failed(&user, earlier[2], "Synthetic failed write")
        .await
        .unwrap();

    let (review, rows) = approved(
        &pool,
        &user,
        &[
            planned_page('e', "Start Here", false),
            planned_page('f', "Second", false),
            planned_page('8', "Edited body", false),
            planned_page('7', "Owner excluded this page", false),
        ],
    )
    .await;
    let [start, second, edited] = [rows[0], rows[1], rows[2]].map(write::document_id);
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        link_inputs: [
            (
                start,
                ['f', 'a', 'b', 'c', 'd', '7', '9'].map(reference).to_vec(),
            ),
            (second, vec![reference('e')]),
            (edited, vec![reference('f')]),
        ]
        .into(),
        edited_bodies: [edited].into(),
        inaccessible_documents: [inaccessible].into(),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        no_connections(),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(CancellationToken::new(), tracker.clone());
    planned(&repo, &user).await;

    service
        .start_notion_write(
            &user,
            review,
            NotionWriteChoices {
                excluded: vec![rows[3]],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    assert_eq!(
        service.notion_import_report(&user).await.unwrap().status,
        Some(RunStatus::Completed)
    );
    let replacements = writer.replaced_links.lock().unwrap();
    assert_eq!(
        replacements.len(),
        2,
        "edited and previously imported bodies are never patched"
    );
    assert_eq!(
        replacements[&start],
        vec![
            (reference('f'), NotionLinkDestination::Page(second)),
            (reference('a'), NotionLinkDestination::Page(prior_document)),
        ]
    );
    assert_eq!(
        replacements[&second],
        vec![(reference('e'), NotionLinkDestination::Page(start))]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deferred_database_links_require_the_exact_container_and_confirmed_view(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use models_databases::{
        TableId,
        views::{NewView, RequestedLayout, ViewId},
    };

    let user = teammate(&pool, "database-link-author", Uuid::now_v7()).await;
    let repo = PgImportRepo::new(pool.clone());
    let (_, prior) = approved(
        &pool,
        &user,
        &[PlanRow {
            kind: ImportKind::DataSource,
            ..planned_page('5', "Launch Work", false)
        }],
    )
    .await;
    let database = Uuid::now_v7();
    let table = TableId::from_uuid(Uuid::now_v7());
    let board = ViewId::from_uuid(Uuid::now_v7());

    repo.claim_importing(&user, &prior, &[], None)
        .await
        .unwrap();
    repo.record_written(
        &user,
        &[
            WrittenObject::own(prior[0], WrittenKind::Database, database),
            WrittenObject::own(prior[0], WrittenKind::Table, table.into_uuid()),
            WrittenObject::for_row(
                prior[0],
                WrittenKind::View,
                &page_id('1'),
                board.into_uuid(),
            ),
        ],
    )
    .await
    .unwrap();
    repo.mark_imported(&user, prior[0], &database.to_string(), "database", None)
        .await
        .unwrap();

    let (review, rows) = approved(&pool, &user, &[planned_page('e', "Start Here", false)]).await;
    let start = write::document_id(rows[0]);
    let valid = NotionLinkReference {
        id: page_id('6'),
        view_id: Some(page_id('1')),
    };
    let not_saved = NotionLinkReference {
        view_id: Some(page_id('2')),
        ..valid.clone()
    };
    let wrong_container = NotionLinkReference {
        id: page_id('4'),
        ..valid.clone()
    };
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        link_inputs: [(start, vec![valid.clone(), wrong_container, not_saved])].into(),
        saved_views: Mutex::new(vec![(
            database,
            board,
            NewView {
                name: "Work Board".into(),
                query: Default::default(),
                layout: RequestedLayout::Table {
                    columns: Vec::new(),
                },
            },
        )]),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        no_connections(),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(CancellationToken::new(), tracker.clone());
    planned(&repo, &user).await;
    service
        .start_notion_write(&user, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    assert_eq!(
        writer.replaced_links.lock().unwrap()[&start],
        vec![(
            valid,
            NotionLinkDestination::Database {
                database,
                table,
                view: Some(board)
            }
        )],
    );
}
