//! Inline database and page siblings use the same ledger order in every phase.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inline_database_and_page_siblings_keep_review_order_through_write_and_done(pool: PgPool) {
    let user = member(&pool, "inline-order-owner", Uuid::now_v7()).await;
    let repo = PgImportRepo::new(pool);
    let mut rows = vec![PlanRow {
        kind: ImportKind::Page,
        foreign_id: "root".into(),
        parent_foreign_id: None,
        metadata: serde_json::json!({"title":"Root", "plan":{"decision":"copy", "path":[]}}),
    }];
    let expected: Vec<_> = (0..128)
        .map(|index| format!("source-{:03}", (index * 73) % 128))
        .collect();
    for (index, id) in expected.iter().enumerate() {
        rows.push(PlanRow {
            kind: if index % 2 == 0 {
                ImportKind::DataSource
            } else {
                ImportKind::Page
            },
            foreign_id: id.clone(),
            parent_foreign_id: Some("root".into()),
            metadata: serde_json::json!({
                "title": id,
                "plan": {"decision":"copy", "path":["Root"], "inlineOn":["root"]}
            }),
        });
    }
    let staged = repo
        .replace_plan(&user, ImportSource::Notion, &rows)
        .await
        .unwrap();
    let parent = staged[0].id;
    let siblings: Vec<_> = staged
        .iter()
        .filter(|row| row.parent_id == Some(parent))
        .collect();
    assert_eq!(siblings.len(), 128);
    assert_eq!(
        siblings
            .iter()
            .filter(|row| row.kind == ImportKind::DataSource)
            .count(),
        64
    );
    assert!(
        siblings
            .iter()
            .all(|row| row.created_at == staged[0].created_at)
    );

    for (phase, status) in [
        ("review", ImportStatus::Staged),
        ("writing", ImportStatus::Importing),
        ("done", ImportStatus::Imported),
    ] {
        let listed = repo
            .list(&user, Some(ImportSource::Notion), None)
            .await
            .unwrap();
        let children: Vec<_> = listed
            .iter()
            .filter(|row| row.parent_id == Some(parent))
            .collect();
        assert!(children.iter().all(|row| row.status == status), "{phase}");
        assert_eq!(
            children
                .iter()
                .map(|row| &row.foreign_id)
                .collect::<Vec<_>>(),
            expected.iter().collect::<Vec<_>>(),
            "{phase}: inline databases and page siblings retain the reviewed order"
        );
        match status {
            ImportStatus::Staged => {
                // Updates in reverse order expose the timestamp tie in the old listing.
                for row in siblings.iter().rev() {
                    repo.mark_importing(&user, &[row.id]).await.unwrap();
                }
            }
            ImportStatus::Importing => {
                for row in &siblings {
                    let entity_type = if row.kind == ImportKind::DataSource {
                        "database"
                    } else {
                        "md"
                    };
                    repo.mark_imported(&user, row.id, &row.id.to_string(), entity_type, None)
                        .await
                        .unwrap();
                }
            }
            ImportStatus::Imported => {}
            ImportStatus::Discarded => panic!("the fixture never discards siblings"),
        }
    }
}
