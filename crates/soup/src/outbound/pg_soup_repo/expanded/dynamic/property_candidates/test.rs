use super::*;
use item_filters::ast::{chat::ChatLiteral, document::DocumentLiteral, project::ProjectLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_grouping::{CandidateCursor, CandidateDirection, CandidateQuery};
use properties::PropertiesService;
use std::sync::Arc;

type Definitions = properties::PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl<entity_access::domain::ports::NoOpEntityAccessService>,
    UnusedNotifications,
>;
struct UnusedNotifications;
impl properties::NotificationService for UnusedNotifications {
    type Err = anyhow::Error;
    async fn send_task_assigned<'a>(
        &self,
        _: properties::domain::model::TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        unreachable!("query authorization never sends notifications")
    }
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn custom_date_sort_preserves_filters_access_and_null_continuations(
    db: PgPool,
) -> anyhow::Result<()> {
    const DOCUMENT: &str = "11111111-0000-0000-0000-000000000000";
    const TASK: &str = "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const CHAT: &str = "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const PROJECT: &str = "aaaaaaaa-ffff-ffff-ffff-ffffffffffff";
    const INACCESSIBLE: &str = "11111111-9999-9999-9999-999999999999";
    let definition = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select) VALUES ($1, 'macro|user-1@test.com', 'Review Date', 'DATE', false)",
        definition
    ).execute(&db).await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        TASK
    )
    .execute(&db)
    .await?;
    for (id, entity_type, value) in [
        (
            DOCUMENT,
            "DOCUMENT",
            serde_json::json!({"type":"Date","value":"2026-05-01T00:00:00Z"}),
        ),
        (
            TASK,
            "TASK",
            serde_json::json!({"type":"Date","value":"2026-05-02T00:00:00Z"}),
        ),
        (
            TASK,
            "DOCUMENT",
            serde_json::json!({"type":"Date","value":"1900-01-01T00:00:00Z"}),
        ),
        (
            CHAT,
            "CHAT",
            serde_json::json!({"type":"Date","value":"2026-05-02T00:00:00Z"}),
        ),
        (
            PROJECT,
            "PROJECT",
            serde_json::json!({"type":"String","value":"not a timestamp"}),
        ),
        (
            INACCESSIBLE,
            "DOCUMENT",
            serde_json::json!({"type":"Date","value":"1800-01-01T00:00:00Z"}),
        ),
    ] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, $3::text::property_entity_type, $4, $5)",
            Uuid::now_v7(), id, entity_type, definition, value
        ).execute(&db).await?;
    }
    let filters = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::or(
            Expr::val(DocumentLiteral::Id(DOCUMENT.parse()?)),
            Expr::or(
                Expr::val(DocumentLiteral::Id(TASK.parse()?)),
                Expr::val(DocumentLiteral::Id(INACCESSIBLE.parse()?)),
            ),
        ))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(CHAT.parse()?)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
            PROJECT.parse()?,
        )))),
        ..Default::default()
    };
    let definitions = Definitions::new(properties::PropertiesPgRepo::new(db.clone()), None, None);
    let viewer = MacroUserIdStr::parse_from_str("macro|user-1@test.com")?;
    for (direction, expected) in [
        (
            CandidateDirection::Ascending,
            [DOCUMENT, TASK, CHAT, PROJECT],
        ),
        (
            CandidateDirection::Descending,
            [TASK, CHAT, DOCUMENT, PROJECT],
        ),
    ] {
        let mut selection = CandidateQuery {
            date_property_id: Some(definition),
            timestamp_sort: None,
            direction,
            grouping: None,
            cursor: None,
            limit: 1,
        };
        for (index, expected) in expected.into_iter().enumerate() {
            let page = select(
                &db,
                PropertyCandidateRequest {
                    filter: filters.clone(),
                    selection: definitions
                        .authorize_property_query(viewer.clone(), None, selection.clone())
                        .await?,
                },
            )
            .await?;
            assert_eq!(page.candidates.len(), 1);
            assert_eq!(page.candidates[0].identity.id, expected);
            assert_eq!(page.groups[0].total_count, 4);
            assert_eq!(page.groups[0].before_or_at_cursor_count, index as i64);
            assert_eq!(page.groups[0].has_more, index < 3);
            if expected == TASK {
                assert_eq!(page.candidates[0].identity.entity_type, "TASK");
            }
            selection.cursor = Some(CandidateCursor {
                identity: page.candidates[0].identity.clone(),
                sort_value: page.candidates[0].sort_value,
            });
        }
        let page = select(
            &db,
            PropertyCandidateRequest {
                filter: filters.clone(),
                selection: definitions
                    .authorize_property_query(viewer.clone(), None, selection.clone())
                    .await?,
            },
        )
        .await?;
        assert!(page.candidates.is_empty());
        assert_eq!(page.groups[0].total_count, 4);
        assert_eq!(page.groups[0].before_or_at_cursor_count, 4);
        selection.cursor = None;
        assert!(matches!(
            definitions
                .authorize_property_query(
                    MacroUserIdStr::parse_from_str("macro|no-access@test.com")?,
                    None,
                    selection.clone()
                )
                .await,
            Err(properties::PropertiesErr::NotFound)
        ));
        let denied_filter = EntityFilterAst {
            document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(
                INACCESSIBLE.parse()?,
            )))),
            chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
            project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
                Uuid::nil(),
            )))),
            ..Default::default()
        };
        let denied = select(
            &db,
            PropertyCandidateRequest {
                filter: denied_filter,
                selection: definitions
                    .authorize_property_query(viewer.clone(), None, selection)
                    .await?,
            },
        )
        .await?;
        assert!(denied.candidates.is_empty());
        assert!(denied.groups.is_empty());
    }
    Ok(())
}
