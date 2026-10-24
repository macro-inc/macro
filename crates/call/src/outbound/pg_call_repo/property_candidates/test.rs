use super::*;
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::{
    PgCallRepo,
    test::{CALL_ARCHIVED, CALL1, CH1, USER_A, USER_B, insert_user_mapping},
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{
    CandidateCursor, CandidateDirection, CandidateQuery, GroupByField, GroupingConfig,
    PropertyBucketing, PropertyDateRange, PropertyDateRanges,
};
use properties::PropertiesService;
use std::{ops::Deref, sync::Arc};
use uuid::Uuid;

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

struct Fixture {
    repo: PgCallRepo,
    imported: Uuid,
    sort_property: Uuid,
    group_property: Uuid,
    definitions: Definitions,
}

async fn fixture(pool: &PgPool) -> anyhow::Result<Fixture> {
    insert_user_mapping(pool, USER_A.deref(), Uuid::from_u128(1)).await?;
    let imported = Uuid::now_v7();
    let permission = Uuid::now_v7().to_string();
    let sort_property = Uuid::now_v7();
    let group_property = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "createdAt", "updatedAt") VALUES ($1, now(), now())"#,
        permission
    )
    .execute(pool)
    .await?;
    sqlx::query!("INSERT INTO call_entities (id, user_id, title, created_via, share_permission_id) VALUES ($1, $2, 'Imported call', 'import', $3)", imported, USER_A.as_ref(), permission).execute(pool).await?;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'call', $2, 'user', 'owner'), ($1, 'call', $3, 'channel', 'view')", imported, USER_A.as_ref(), CH1.to_string()).execute(pool).await?;
    sqlx::query!("INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select) VALUES ($1, $3, 'Review Date', 'DATE', false), ($2, $3, 'Group Date', 'DATE', false)", sort_property, group_property, USER_A.as_ref()).execute(pool).await?;
    for (id, property, value) in [
        (
            CALL1,
            sort_property,
            serde_json::json!({"type":"Date","value":"2026-04-02T00:00:00Z"}),
        ),
        (
            CALL_ARCHIVED,
            sort_property,
            serde_json::json!({"type":"Date","value":"2026-04-01T00:00:00Z"}),
        ),
        (
            CALL1,
            group_property,
            serde_json::json!({"type":"Date","value":"2026-02-01T00:00:00Z"}),
        ),
        (
            imported,
            group_property,
            serde_json::json!({"type":"Date","value":"2026-02-01T00:00:00Z"}),
        ),
        (
            CALL_ARCHIVED,
            group_property,
            serde_json::json!({"type":"Date","value":"2026-03-01T00:00:00Z"}),
        ),
    ] {
        sqlx::query!("INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'CALL_RECORD', $3, $4)", Uuid::now_v7(), id.to_string(), property, value).execute(pool).await?;
    }
    Ok(Fixture {
        repo: PgCallRepo::new(pool.clone()),
        definitions: Definitions::new(properties::PropertiesPgRepo::new(pool.clone()), None, None),
        imported,
        sort_property,
        group_property,
    })
}

impl Fixture {
    async fn authorize(
        &self,
        query: CandidateQuery,
    ) -> anyhow::Result<properties::AuthorizedPropertyQuery> {
        Ok(self
            .definitions
            .authorize_property_query(USER_A.deref().clone(), None, query)
            .await?)
    }
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS"
)]
async fn native_and_imported_calls_share_null_safe_date_pages(pool: PgPool) -> anyhow::Result<()> {
    let data = fixture(&pool).await?;
    // Native rows also have call_entities mirrors. Only one identity counts.
    let mirrored = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM call_entities WHERE created_via = 'native' AND id IN ($1, $2)", CALL1, CALL_ARCHIVED).fetch_one(&pool).await?;
    assert_eq!(mirrored, 2);
    for (direction, expected) in [
        (
            CandidateDirection::Ascending,
            [CALL_ARCHIVED, CALL1, data.imported],
        ),
        (
            CandidateDirection::Descending,
            [CALL1, CALL_ARCHIVED, data.imported],
        ),
    ] {
        let mut selection = CandidateQuery {
            date_property_id: Some(data.sort_property),
            timestamp_sort: None,
            direction,
            grouping: None,
            cursor: None,
            limit: 1,
        };
        for (index, id) in expected.into_iter().enumerate() {
            let page = data
                .repo
                .get_call_candidates(CallCandidateRequest {
                    filter: None,
                    selection: data.authorize(selection.clone()).await?,
                })
                .await?;
            assert_eq!(page.entity_types, ["CALL_RECORD"]);
            assert_eq!(page.candidates.len(), 1);
            assert_eq!(page.candidates[0].identity.id, id.to_string());
            assert_eq!(page.groups[0].total_count, 3);
            assert_eq!(page.groups[0].before_or_at_cursor_count, index as i64);
            selection.cursor = Some(CandidateCursor {
                identity: page.candidates[0].identity.clone(),
                sort_value: page.candidates[0].sort_value,
            });
        }
        let final_page = data
            .repo
            .get_call_candidates(CallCandidateRequest {
                filter: None,
                selection: data.authorize(selection).await?,
            })
            .await?;
        assert!(final_page.candidates.is_empty());
        assert_eq!(final_page.entity_types, ["CALL_RECORD"]);
        assert_eq!(final_page.groups[0].before_or_at_cursor_count, 3);
    }
    let selection = CandidateQuery {
        date_property_id: Some(data.sort_property),
        timestamp_sort: None,
        direction: CandidateDirection::Ascending,
        grouping: None,
        cursor: None,
        limit: 10,
    };
    let mixed = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: Some(Arc::new(Expr::or(
                Expr::val(CallLiteral::CallId(data.imported)),
                Expr::val(CallLiteral::Status(CallStatus::Missed)),
            ))),
            selection: data.authorize(selection.clone()).await?,
        })
        .await?;
    assert_eq!(
        mixed
            .candidates
            .iter()
            .map(|candidate| candidate.identity.id.as_str())
            .collect::<Vec<_>>(),
        [data.imported.to_string()]
    );
    let null_channel = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: Some(Arc::new(Expr::is_not(Expr::val(CallLiteral::ChannelId(
                CH1,
            ))))),
            selection: data.authorize(selection.clone()).await?,
        })
        .await?;
    assert_eq!(null_channel.candidates.len(), 1);
    assert_eq!(
        null_channel.candidates[0].identity.id,
        data.imported.to_string()
    );
    assert!(matches!(
        data.definitions
            .authorize_property_query(USER_B.deref().clone(), None, selection.clone())
            .await,
        Err(properties::PropertiesErr::NotFound)
    ));
    for viewer in [
        USER_B.deref().clone(),
        MacroUserIdStr::parse_from_str("macro|stranger@test.com")?,
    ] {
        let denied = data
            .repo
            .get_call_candidates(CallCandidateRequest {
                filter: Some(Arc::new(Expr::val(CallLiteral::CallId(data.imported)))),
                selection: data
                    .definitions
                    .authorize_property_query(
                        viewer,
                        None,
                        CandidateQuery {
                            date_property_id: None,
                            timestamp_sort: Some(SimpleSortMethod::UpdatedAt),
                            ..selection.clone()
                        },
                    )
                    .await?,
            })
            .await?;
        assert!(denied.candidates.is_empty());
        assert!(denied.groups.is_empty());
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS"
)]
async fn date_groups_preserve_counts_filters_and_an_independent_sort_property(
    pool: PgPool,
) -> anyhow::Result<()> {
    let data = fixture(&pool).await?;
    let boundary: DateTime<Utc> = "2026-03-01T00:00:00Z".parse()?;
    let mut selection = CandidateQuery {
        date_property_id: Some(data.sort_property),
        timestamp_sort: None,
        direction: CandidateDirection::Ascending,
        cursor: None,
        limit: 1,
        grouping: Some(
            GroupingConfig::new(GroupByField::Property {
                property_definition_id: data.group_property,
                entity_type: None,
                bucketing: Some(PropertyBucketing::DateRanges(PropertyDateRanges {
                    ranges: vec![
                        PropertyDateRange {
                            key: "z_early".into(),
                            start: None,
                            end: Some(boundary),
                        },
                        PropertyDateRange {
                            key: "a_late".into(),
                            start: Some(boundary),
                            end: None,
                        },
                    ],
                    missing_value_bucket_key: "missing".into(),
                })),
            })
            .with_limit(1),
        ),
    };
    let page = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: None,
            selection: data.authorize(selection.clone()).await?,
        })
        .await?;
    assert_eq!(
        page.groups
            .iter()
            .map(|group| (group.group_key.as_str(), group.total_count))
            .collect::<Vec<_>>(),
        [("z_early", 2), ("a_late", 1)]
    );
    assert_eq!(page.candidates.len(), 2);
    let early = &page.candidates[0];
    assert_eq!(early.identity.id, CALL1.to_string());
    selection.grouping.as_mut().unwrap().group_key = Some("z_early".into());
    selection.cursor = Some(CandidateCursor {
        identity: early.identity.clone(),
        sort_value: early.sort_value,
    });
    let continued = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: None,
            selection: data.authorize(selection.clone()).await?,
        })
        .await?;
    assert_eq!(continued.candidates.len(), 1);
    assert_eq!(
        continued.candidates[0].identity.id,
        data.imported.to_string()
    );
    assert_eq!(continued.groups[0].total_count, 2);
    assert_eq!(continued.groups[0].before_or_at_cursor_count, 1);

    selection.cursor = None;
    selection.grouping = None;
    let property_filter = Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: data.sort_property,
        entity_type: None,
        value: PropertyMatchValue::DatePresent,
    }));
    let missing = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: Some(Arc::new(Expr::is_not(property_filter))),
            selection: data.authorize(selection).await?,
        })
        .await?;
    assert_eq!(missing.candidates.len(), 1);
    assert_eq!(missing.candidates[0].identity.id, data.imported.to_string());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS"
)]
async fn boolean_filters_use_rendered_speakers_and_guard_date_values(
    pool: PgPool,
) -> anyhow::Result<()> {
    let data = fixture(&pool).await?;
    sqlx::query!("INSERT INTO call_transcripts (call_id, segment_id, speaker_id, content, started_at, ended_at, sequence_num) VALUES ($1, 'candidate-filter', $2, 'hello', now(), now(), 1)", CALL1, USER_A.as_ref()).execute(&pool).await?;
    sqlx::query!(
        "UPDATE call_record_transcripts SET custom_speaker = $1 WHERE call_record_id = $2",
        USER_B.as_ref(),
        CALL_ARCHIVED
    )
    .execute(&pool)
    .await?;
    let speaker = Uuid::now_v7();
    let transcript = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO call_entity_participants (call_id, id, user_id) VALUES ($1, $2, $3)",
        data.imported,
        speaker,
        USER_A.as_ref()
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO call_entity_transcripts (call_id, id) VALUES ($1, $2)",
        data.imported,
        transcript
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO call_entity_transcript_segments (call_id, transcript_id, sequence_num, participant_id, content) VALUES ($1, $2, 0, $3, 'imported words')", data.imported, transcript, speaker).execute(&pool).await?;
    let imported = data
        .repo
        .get_call_record_by_call_id(&data.imported)
        .await?
        .unwrap();
    assert_eq!(imported.transcript[0].speaker_id, speaker.to_string());
    sqlx::query!("INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'CALL_RECORD', $3, '{\"type\":\"String\",\"value\":\"not a timestamp\"}'::jsonb)", Uuid::now_v7(), data.imported.to_string(), data.sort_property).execute(&pool).await?;
    let selection = CandidateQuery {
        date_property_id: Some(data.sort_property),
        timestamp_sort: None,
        direction: CandidateDirection::Ascending,
        grouping: None,
        cursor: None,
        limit: 10,
    };
    let authorized = data.authorize(selection.clone()).await?;
    let request = |filter| CallCandidateRequest {
        filter: Some(Arc::new(filter)),
        selection: authorized.clone(),
    };
    let speakers = data
        .repo
        .get_call_candidates(request(Expr::and(
            Expr::val(CallLiteral::Speaker(USER_A.deref().clone())),
            Expr::or(
                Expr::val(CallLiteral::CallId(data.imported)),
                Expr::val(CallLiteral::Attended(true)),
            ),
        )))
        .await?;
    assert_eq!(
        speakers
            .candidates
            .iter()
            .map(|row| row.identity.id.clone())
            .collect::<Vec<_>>(),
        [CALL1.to_string()]
    );
    assert_eq!(speakers.groups[0].total_count, 1);
    let other_speaker = data
        .repo
        .get_call_candidates(request(Expr::is_not(Expr::val(CallLiteral::Speaker(
            USER_A.deref().clone(),
        )))))
        .await?;
    assert_eq!(
        other_speaker.candidates[0].identity.id,
        CALL_ARCHIVED.to_string()
    );
    assert_eq!(other_speaker.groups[0].total_count, 2);
    assert_eq!(
        other_speaker.candidates[1].identity.id,
        data.imported.to_string()
    );
    let range = Expr::val(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: data.sort_property,
        entity_type: None,
        value: PropertyMatchValue::DateRange(item_filters::ast::properties::DateRange {
            start: Some("2026-04-02T00:00:00Z".parse()?),
            end: None,
        }),
    }));
    let dated = data
        .repo
        .get_call_candidates(request(Expr::and(
            range,
            Expr::val(CallLiteral::Attended(true)),
        )))
        .await?;
    assert_eq!(dated.candidates.len(), 1);
    assert_eq!(dated.candidates[0].identity.id, CALL1.to_string());
    let foreign_scope = data
        .repo
        .get_call_candidates(request(Expr::val(CallLiteral::Property(
            PropertiesLiteral {
                property_definition_id: data.sort_property,
                entity_type: Some(item_filters::ast::properties::PropertyEntityType::Task),
                value: PropertyMatchValue::DatePresent,
            },
        ))))
        .await?;
    assert!(foreign_scope.candidates.is_empty());
    // Provider labels that match an attendee render as guest IDs, including
    // ASCII case differences. Unmatched labels remain the rendered identity.
    for (display_name, label, rendered, matches) in [
        (
            Some(USER_A.as_ref().to_ascii_uppercase()),
            Some(USER_A.to_string()),
            speaker.to_string(),
            0,
        ),
        (
            Some("Another attendee".into()),
            Some(USER_A.to_string()),
            USER_A.to_string(),
            1,
        ),
        (None, None, "Unknown speaker".into(), 0),
    ] {
        sqlx::query!(
            "UPDATE call_entity_participants SET display_name = $1 WHERE call_id = $2 AND id = $3",
            display_name,
            data.imported,
            speaker
        )
        .execute(&pool)
        .await?;
        sqlx::query!("UPDATE call_entity_transcript_segments SET participant_id = NULL, speaker_label = $1 WHERE call_id = $2", label, data.imported).execute(&pool).await?;
        let imported = data
            .repo
            .get_call_record_by_call_id(&data.imported)
            .await?
            .unwrap();
        assert_eq!(imported.transcript[0].speaker_id, rendered);
        let matched = data
            .repo
            .get_call_candidates(request(Expr::and(
                Expr::val(CallLiteral::CallId(data.imported)),
                Expr::val(CallLiteral::Speaker(USER_A.deref().clone())),
            )))
            .await?;
        assert_eq!(matched.candidates.len(), matches);
        let negated = data
            .repo
            .get_call_candidates(request(Expr::and(
                Expr::val(CallLiteral::CallId(data.imported)),
                Expr::is_not(Expr::val(CallLiteral::Speaker(USER_A.deref().clone()))),
            )))
            .await?;
        assert_eq!(negated.candidates.len(), 1 - matches);
    }
    let missed = data
        .repo
        .get_call_candidates(CallCandidateRequest {
            filter: Some(Arc::new(Expr::and(
                Expr::val(CallLiteral::Attended(false)),
                Expr::val(CallLiteral::Status(CallStatus::Missed)),
            ))),
            selection: data
                .definitions
                .authorize_property_query(
                    MacroUserIdStr::parse_from_str("macro|user-c@test.com")?,
                    None,
                    CandidateQuery {
                        date_property_id: None,
                        timestamp_sort: Some(SimpleSortMethod::UpdatedAt),
                        ..selection
                    },
                )
                .await?,
        })
        .await?;
    assert_eq!(missed.candidates.len(), 2);
    assert_eq!(missed.groups[0].total_count, 2);
    Ok(())
}
