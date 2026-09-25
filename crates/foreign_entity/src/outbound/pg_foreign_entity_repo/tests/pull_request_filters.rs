use super::*;

const USER: &str = "macro|user@example.com";

async fn insert_pr(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    metadata: serde_json::Value,
) -> ForeignEntity {
    repo.create_foreign_entity(
        Uuid::now_v7(),
        CreateForeignEntity {
            foreign_entity_id: foreign_entity_id.into(),
            foreign_entity_source: "github_pull_request".into(),
            metadata,
            stored_for_id: USER.into(),
            stored_for_auth_entity: "user".into(),
        },
    )
    .await
    .expect("pull request foreign entity should be inserted")
}

async fn matching_ids(repo: &PgForeignEntityRepo, filter: Expr<ForeignEntityLiteral>) -> Vec<Uuid> {
    let entities = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user(USER)],
            10,
            filter_query(Some(Arc::new(filter))),
        )
        .await
        .expect("filtered foreign entity list should succeed");
    let mut matching = ids(&entities);
    matching.sort();
    matching
}

fn sorted_ids(entities: &[&ForeignEntity]) -> Vec<Uuid> {
    let mut expected: Vec<Uuid> = entities.iter().map(|entity| entity.id).collect();
    expected.sort();
    expected
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repository_status_and_author_filter_on_pull_request_metadata(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let open_macro = insert_pr(
        &repo,
        "macro-inc/macro/pull/1",
        json!({ "repositoryId": 100, "status": "open", "authorId": 7 }),
    )
    .await;
    // Renamed since this row was synced: the id still identifies the repository.
    let merged_macro = insert_pr(
        &repo,
        "macro-inc/old-name/pull/2",
        json!({ "repositoryId": 100, "status": "merged", "authorId": 42 }),
    )
    .await;
    let open_other = insert_pr(
        &repo,
        "macro-inc/other/pull/3",
        json!({ "repositoryId": 200, "status": "open", "authorId": 42 }),
    )
    .await;
    insert_pr(
        &repo,
        "macro-inc/unsynced/pull/4",
        json!({ "status": "open" }),
    )
    .await;

    let repository = || Expr::val(ForeignEntityLiteral::Repository("100".into()));
    assert_eq!(
        matching_ids(&repo, repository()).await,
        sorted_ids(&[&open_macro, &merged_macro])
    );
    assert_eq!(
        matching_ids(
            &repo,
            Expr::and(
                repository(),
                Expr::val(ForeignEntityLiteral::Status("open".into())),
            )
        )
        .await,
        sorted_ids(&[&open_macro])
    );
    assert_eq!(
        matching_ids(
            &repo,
            Expr::or(
                Expr::val(ForeignEntityLiteral::Author("42".into())),
                Expr::val(ForeignEntityLiteral::Author("999".into())),
            )
        )
        .await,
        sorted_ids(&[&merged_macro, &open_other])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn non_numeric_repository_and_author_ids_match_nothing(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    insert_pr(
        &repo,
        "macro-inc/macro/pull/1",
        json!({ "repositoryId": 100, "authorId": 7 }),
    )
    .await;

    for literal in [
        ForeignEntityLiteral::Repository("macro-inc/macro".into()),
        ForeignEntityLiteral::Author("octocat".into()),
    ] {
        assert!(
            matching_ids(&repo, Expr::val(literal.clone()))
                .await
                .is_empty(),
            "{literal:?} should match nothing"
        );
    }
}
