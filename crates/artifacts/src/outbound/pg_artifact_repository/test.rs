use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const ALICE: &str = "macro|alice@artifacts-repo.test";
const DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f";
const PAGE_SHA: &str = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";
const CSS_SHA: &str = "7c98040a541657584690ae2a1cc3b42a8b53b159cc60c5d3abbfecbaeac6c94a";

/// Alice and her artifact document.
async fn insert_artifact_document(pool: &PgPool) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)"#,
        macro_user_id,
        "alice@artifacts-repo.test",
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        ALICE,
        "alice@artifacts-repo.test",
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Onboarding', $2, 'artifact')"#,
        DOCUMENT_ID,
        ALICE,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn version_one() -> NewVersion {
    NewVersion {
        document_id: DOCUMENT_ID.to_string(),
        number: 1,
        manifest: Manifest {
            files: BTreeMap::from([
                (
                    ArtifactPath("index.html".to_string()),
                    StoredFile {
                        sha256: Sha256(PAGE_SHA.to_string()),
                        size: 11,
                        content_type: "text/html".to_string(),
                    },
                ),
                (
                    ArtifactPath("theme.css".to_string()),
                    StoredFile {
                        sha256: Sha256(CSS_SHA.to_string()),
                        size: 6,
                        content_type: "text/css".to_string(),
                    },
                ),
            ]),
            scenes: vec![Scene {
                id: SceneId("home".to_string()),
                title: "Home".to_string(),
                path: ArtifactPath("index.html".to_string()),
            }],
        },
        message: Some("First draft".to_string()),
        created_by: ALICE.to_string(),
        created_by_agent: Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stores_and_reads_back_a_version(pool: PgPool) {
    insert_artifact_document(&pool).await;
    let repository = PgArtifactRepository::new(pool);

    let inserted = repository
        .insert_version(version_one())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(inserted.number, 1);
    assert_eq!(inserted.manifest, version_one().manifest);
    assert_eq!(inserted.message.as_deref(), Some("First draft"));
    assert_eq!(
        inserted.created_by_agent.as_deref(),
        Some("bot|00000000-0000-0000-0000-00000000a1a1")
    );
    assert_eq!(
        repository.version(DOCUMENT_ID, 1).await.unwrap(),
        Some(inserted.clone())
    );
    assert_eq!(
        repository.current_version(DOCUMENT_ID).await.unwrap(),
        Some(inserted)
    );
    assert_eq!(repository.version(DOCUMENT_ID, 2).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_taken_number_is_not_inserted(pool: PgPool) {
    insert_artifact_document(&pool).await;
    let repository = PgArtifactRepository::new(pool);
    repository.insert_version(version_one()).await.unwrap();

    let again = repository.insert_version(version_one()).await.unwrap();

    assert_eq!(again, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_versions_newest_first_with_sizes(pool: PgPool) {
    insert_artifact_document(&pool).await;
    let repository = PgArtifactRepository::new(pool);
    repository.insert_version(version_one()).await.unwrap();
    repository
        .insert_version(NewVersion {
            document_id: DOCUMENT_ID.to_string(),
            number: 2,
            manifest: Manifest {
                files: BTreeMap::from([(
                    ArtifactPath("index.html".to_string()),
                    StoredFile {
                        sha256: Sha256(PAGE_SHA.to_string()),
                        size: 11,
                        content_type: "text/html".to_string(),
                    },
                )]),
                scenes: vec![],
            },
            message: None,
            created_by: ALICE.to_string(),
            created_by_agent: None,
        })
        .await
        .unwrap();

    let versions = repository.versions(DOCUMENT_ID).await.unwrap();

    let shapes: Vec<(i32, usize, u64, Option<&str>)> = versions
        .iter()
        .map(|version| {
            (
                version.number,
                version.file_count,
                version.total_size,
                version.message.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        shapes,
        vec![(2, 1, 11, None), (1, 2, 17, Some("First draft"))]
    );
    assert_eq!(
        repository
            .current_version(DOCUMENT_ID)
            .await
            .unwrap()
            .unwrap()
            .number,
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recorded_sizes_come_from_any_version(pool: PgPool) {
    insert_artifact_document(&pool).await;
    let repository = PgArtifactRepository::new(pool);
    repository.insert_version(version_one()).await.unwrap();

    let sizes = repository
        .recorded_sizes(
            DOCUMENT_ID,
            &HashSet::from([Sha256(CSS_SHA.to_string()), Sha256("1".repeat(64))]),
        )
        .await
        .unwrap();

    assert_eq!(sizes, HashMap::from([(Sha256(CSS_SHA.to_string()), 6)]));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_document_deletes_its_versions(pool: PgPool) {
    insert_artifact_document(&pool).await;
    let repository = PgArtifactRepository::new(pool.clone());
    repository.insert_version(version_one()).await.unwrap();

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, DOCUMENT_ID)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(repository.versions(DOCUMENT_ID).await.unwrap(), vec![]);
}
