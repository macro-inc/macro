use documents::domain::{
    content::DocumentContent,
    create::{DocumentCreator, MarkdownSubtype, NewMarkdownTextDocument, NewNotionDocument},
    models::{CreateTaskRequest, DocumentError, InitialLinkShare, NewDocument},
    notion_markdown::NotionMarkdown,
    ports::{
        create::{DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService},
        markdown::{MarkdownInitializationPort, MarkdownSnapshot},
        mentions::NoOpDocumentMentionTracker,
    },
    response::CreateDocumentResponseData,
};
use macro_user_id::cowlike::CowLike;
use model_owner::CreationPrincipal;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct CreationProbe {
    document: Mutex<Option<NewDocument>>,
}

impl DocumentCreationService for CreationProbe {
    async fn create_document(
        &self,
        _: &CreationPrincipal,
        document: NewDocument,
        _: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        *self.document.lock().unwrap() = Some(document);
        Err(DocumentError::BadRequest(
            "stop after capturing the creation request".into(),
        ))
    }
    async fn initialize_canvas(&self, _: &str) -> Result<(), DocumentError> {
        unreachable!()
    }
    async fn handle_task_properties(
        &self,
        _: &CreationPrincipal,
        _: &str,
        _: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        unreachable!()
    }
    async fn mark_document_uploaded(&self, _: &str) -> Result<(), DocumentError> {
        unreachable!()
    }
    async fn set_document_content(&self, _: &str, _: DocumentContent) -> Result<(), DocumentError> {
        unreachable!()
    }
    async fn cleanup_created_document(&self, _: &str) {
        unreachable!()
    }
}

struct Unused;
impl MarkdownInitializationPort for Unused {
    async fn initialize_existing_markdown(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, DocumentError> {
        unreachable!()
    }
    async fn initialize_existing_notion(
        &self,
        _: &str,
        _: &NotionMarkdown,
    ) -> Result<MarkdownSnapshot, DocumentError> {
        unreachable!()
    }
}
impl DocumentBytesUploadPort for Unused {
    async fn upload_document_bytes(&self, _: DocumentBytesUpload) -> Result<(), DocumentError> {
        unreachable!()
    }
}

/// Exercise the import's initial link policy against the real access repository.
/// No direct or folder grants are installed, so only document link access can win.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn personal_imports_deny_teammate_link_access(pool: sqlx::PgPool) -> anyhow::Result<()> {
    imported_link_access(
        &pool,
        import::domain::ports::ImportVisibility::Personal,
        None,
    )
    .await
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_imports_retain_teammate_link_access(pool: sqlx::PgPool) -> anyhow::Result<()> {
    imported_link_access(
        &pool,
        import::domain::ports::ImportVisibility::Shared,
        Some(entity_access::domain::models::AccessLevel::Edit),
    )
    .await
}

async fn imported_link_access(
    pool: &sqlx::PgPool,
    sharing: import::domain::ports::ImportVisibility,
    expected: Option<entity_access::domain::models::AccessLevel>,
) -> anyhow::Result<()> {
    use entity_access::domain::ports::AccessRepository;
    use entity_access::outbound::PgAccessRepository;
    use macro_user_id::user_id::MacroUserIdStr;
    use models_permissions::share_permission::{
        LinkShare, SharePermissionV2, TeamLinkShareDefault,
    };
    use uuid::Uuid;

    let LinkFixture {
        owner,
        teammate,
        team,
        folder,
    } = team_link_folder(pool).await?;
    let access = PgAccessRepository::new(pool.clone());
    let mut unexpected_access = Vec::new();
    for scope in [LinkShare::Team, LinkShare::Public] {
        for (kind, is_task, is_notion) in [
            ("page", false, true),
            ("row body", false, true),
            ("Notion task", true, true),
            ("Linear task", true, false),
            ("Jira task", true, false),
        ] {
            let probe = Arc::new(CreationProbe::default());
            let creator = DocumentCreator::new(
                Arc::clone(&probe),
                Unused,
                Unused,
                NoOpDocumentMentionTracker,
            );
            let metadata = super::super::imported_document_metadata(kind, sharing).build();
            let subtype = if is_task {
                MarkdownSubtype::Task {
                    property_values: None,
                    share_with_team: false,
                    team_id: Some(team),
                }
            } else {
                MarkdownSubtype::Note
            };
            let principal = crate::ToolEntityCreator::creation_principal(
                &MacroUserIdStr::parse_from_str(&owner)?.into_owned(),
            );
            // Stop at the creation service boundary, after the real metadata and
            // subtype conversion but before editor initialization.
            let result = if is_notion {
                creator
                    .create_notion_markdown(
                        &principal,
                        NewNotionDocument {
                            metadata,
                            notion: crate::import_workspace::notion_markdown(
                                "Body",
                                &Default::default(),
                            ),
                            subtype,
                        },
                    )
                    .await
            } else {
                creator
                    .create_markdown_text(
                        &principal,
                        NewMarkdownTextDocument {
                            metadata,
                            markdown: "Body".into(),
                            subtype,
                        },
                    )
                    .await
            };
            assert!(result.is_err());
            let document = probe
                .document
                .lock()
                .unwrap()
                .take()
                .expect("creation was called");
            let permission = match document.initial_link_share {
                InitialLinkShare::Exact(state) => SharePermissionV2::from_link_share_state(state),
                InitialLinkShare::EntityDefault => {
                    SharePermissionV2::new_document_share_permission(
                        document.file_type,
                        Some(TeamLinkShareDefault(Some(scope))),
                    )
                }
            };
            let document = Uuid::now_v7().to_string();
            let permission_id = Uuid::now_v7().to_string();
            sqlx::query!(
                "INSERT INTO \"Document\" (id, name, owner, \"projectId\", \"fileType\", uploaded) VALUES ($1, $2, $3, $4, 'md', true)",
                &document,
                kind,
                owner,
                folder.to_string()
            )
            .execute(pool)
            .await?;
            sqlx::query!("INSERT INTO \"SharePermission\" (id, \"linkShare\", \"linkShareAccessLevel\") VALUES ($1, $2, $3::text::\"AccessLevel\")", &permission_id, permission.link_share.map(|scope| scope.to_string()), permission.link_share_access_level.map(|level| level.to_string()))
                .execute(pool).await?;
            sqlx::query!("INSERT INTO \"DocumentPermission\" (\"documentId\", \"sharePermissionId\") VALUES ($1, $2)", &document, permission_id).execute(pool).await?;
            let granted = access
                .get_document_access(&document, Some(&teammate.0))
                .await?;
            if granted != expected {
                unexpected_access.push(format!(
                    "{kind} with {scope:?} default and {sharing:?}: {granted:?}"
                ));
            }
        }
    }
    assert!(
        unexpected_access.is_empty(),
        "unexpected link access: {unexpected_access:?}"
    );
    Ok(())
}

struct LinkFixture {
    owner: String,
    teammate: macro_user_id::user_id::MacroUserIdStr<'static>,
    team: uuid::Uuid,
    folder: uuid::Uuid,
}

async fn team_link_folder(pool: &sqlx::PgPool) -> anyhow::Result<LinkFixture> {
    use entity_access::{
        domain::{models::AccessLevel, ports::AccessRepository},
        outbound::PgAccessRepository,
    };
    use macro_user_id::user_id::MacroUserIdStr;
    use uuid::Uuid;
    // Access source ids are cached by user id across test databases.
    let run = Uuid::now_v7();
    let owner = format!("macro|import-owner-{run}@example.com");
    let teammate =
        MacroUserIdStr::parse_from_str(&format!("macro|import-teammate-{run}@example.com"))?
            .into_owned();
    for user in [owner.as_str(), teammate.as_ref()] {
        let macro_id = Uuid::now_v7();
        sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)", macro_id, user).execute(pool).await?;
        sqlx::query!(
            "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $1, $2)",
            user,
            macro_id
        )
        .execute(pool)
        .await?;
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Import Team', $2)",
        team,
        owner
    )
    .execute(pool)
    .await?;
    sqlx::query!("INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $3, 'owner'), ($2, $3, 'member')", owner, teammate.as_ref(), team).execute(pool).await?;

    let folder = Uuid::now_v7();
    let permission = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Imported folder', $2)"#,
        folder.to_string(),
        owner
    )
    .execute(pool)
    .await?;
    sqlx::query!(r#"INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES ($1, 'TEAM', 'edit')"#, &permission).execute(pool).await?;
    sqlx::query!(
        r#"INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES ($1, $2)"#,
        folder.to_string(),
        permission
    )
    .execute(pool)
    .await?;
    assert_eq!(
        PgAccessRepository::new(pool.clone())
            .get_project_access(&folder.to_string(), Some(&teammate.0))
            .await?,
        Some(AccessLevel::Edit)
    );
    Ok(LinkFixture {
        owner,
        teammate,
        team,
        folder,
    })
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn team_folder_link_does_not_open_an_owner_only_child(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    use entity_access::{domain::ports::AccessRepository, outbound::PgAccessRepository};
    let LinkFixture {
        owner,
        teammate,
        folder,
        ..
    } = team_link_folder(&pool).await?;
    let document = uuid::Uuid::now_v7().to_string();
    let permission = uuid::Uuid::now_v7().to_string();
    sqlx::query!(r#"INSERT INTO "Document" (id, name, owner, "fileType", uploaded, "projectId") VALUES ($1, 'Personal child', $3, 'md', true, $2)"#, &document, folder.to_string(), owner).execute(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#,
        &permission
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES ($1, $2)"#,
        &document,
        permission
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        PgAccessRepository::new(pool)
            .get_document_access(&document, Some(&teammate.0))
            .await?,
        None
    );
    Ok(())
}
