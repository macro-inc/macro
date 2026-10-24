use filter_ast::Expr;
use item_filters::ast::{
    call::CallLiteral,
    properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue},
};
use uuid::Uuid;

use super::*;

const COMPANIES: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000c);
const TAGS: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b7ff);

fn company(id: &str) -> Expr<CallLiteral> {
    Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: COMPANIES,
        entity_type: None,
        value: PropertyMatchValue::EntityRef(EntityRefId::new(id.to_string()).unwrap()),
    }))
}

fn tag(option: u128) -> Expr<CallLiteral> {
    Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: TAGS,
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::from_u128(option)),
    }))
}

fn has(id: &str) -> PropertyTerm {
    PropertyTerm {
        condition: PropertyCondition::EntityRef {
            definition: COMPANIES,
            entity_id: id.to_string(),
        },
        negated: false,
    }
}

fn lacks(id: &str) -> PropertyTerm {
    PropertyTerm {
        negated: true,
        ..has(id)
    }
}

fn tagged(option: u128) -> PropertyTerm {
    PropertyTerm {
        condition: PropertyCondition::Tag(Uuid::from_u128(option).to_string()),
        negated: false,
    }
}

fn clauses_of(expr: Expr<CallLiteral>) -> Vec<Vec<PropertyTerm>> {
    property_clauses(&Some(std::sync::Arc::new(expr))).unwrap()
}

#[test]
fn keeps_and_or_and_not_structure() {
    assert_eq!(clauses_of(company("a")), vec![vec![has("a")]]);
    assert_eq!(
        clauses_of(Expr::or(company("a"), company("b"))),
        vec![vec![has("a"), has("b")]]
    );
    assert_eq!(
        clauses_of(Expr::and(company("a"), company("b"))),
        vec![vec![has("a")], vec![has("b")]]
    );
    assert_eq!(
        clauses_of(Expr::is_not(company("a"))),
        vec![vec![lacks("a")]]
    );
    // De Morgan: NOT (a AND b) = NOT a OR NOT b.
    assert_eq!(
        clauses_of(Expr::is_not(Expr::and(company("a"), company("b")))),
        vec![vec![lacks("a"), lacks("b")]]
    );
    // (a AND b) OR c distributes into (a OR c) AND (b OR c).
    assert_eq!(
        clauses_of(Expr::or(
            Expr::and(company("a"), company("b")),
            company("c")
        )),
        vec![vec![has("a"), has("c")], vec![has("b"), has("c")]]
    );
}

#[test]
fn tags_keep_any_and_all_semantics() {
    // ANY: options ORed together.
    assert_eq!(
        clauses_of(Expr::or(tag(1), tag(2))),
        vec![vec![tagged(1), tagged(2)]]
    );
    // ALL: options ANDed together, even next to a channel filter.
    let channel = Expr::Literal(CallLiteral::ChannelId(Uuid::from_u128(9)));
    assert_eq!(
        clauses_of(Expr::and(channel, Expr::and(tag(1), tag(2)))),
        vec![vec![tagged(1)], vec![tagged(2)]]
    );
}

#[test]
fn a_tag_or_a_reference_is_one_clause() {
    assert_eq!(
        clauses_of(Expr::or(tag(1), company("a"))),
        vec![vec![tagged(1), has("a")]]
    );
}

#[test]
fn other_call_literals_leave_properties_unconstrained() {
    let channel = || Expr::Literal(CallLiteral::ChannelId(Uuid::nil()));
    // ANDed in, as soup folds properties into the call filter.
    assert_eq!(
        clauses_of(Expr::and(channel(), company("a"))),
        vec![vec![has("a")]]
    );
    assert!(clauses_of(Expr::or(channel(), company("a"))).is_empty());
    assert!(clauses_of(channel()).is_empty());
    assert!(property_clauses(&None).unwrap().is_empty());
}

#[test]
fn flattens_clauses_into_query_parameters() {
    let params = clause_params(&[vec![tagged(1), has("a")], vec![lacks("b")]]);

    assert_eq!(
        params,
        PropertyClauseParams {
            clause_count: 2,
            clause_indices: vec![0, 0, 1],
            negated: vec![false, false, true],
            definition_ids: vec![None, Some(COMPANIES), Some(COMPANIES)],
            values: vec![
                Some(Uuid::from_u128(1).to_string()),
                Some("a".to_string()),
                Some("b".to_string())
            ],
            date_terms: vec![false, false, false],
            date_starts: vec![None, None, None],
            date_ends: vec![None, None, None],
        }
    );
}

#[test]
fn oversized_filters_are_rejected_without_dropping_dates() {
    // 9 nested ORs of two-term ANDs expand to 2^9 = 512 clauses.
    let expr = (0..9).fold(company("seed"), |acc, i| {
        Expr::or(
            acc,
            Expr::and(company(&format!("x{i}")), company(&format!("y{i}"))),
        )
    });
    let date = Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: Uuid::from_u128(4),
        entity_type: None,
        value: PropertyMatchValue::DatePresent,
    }));
    let filter = Some(std::sync::Arc::new(Expr::and(date, expr)));
    assert!(
        matches!(property_clauses(&filter), Err(sqlx::Error::Protocol(message)) if message.contains("256 clauses"))
    );
}

#[test]
fn date_terms_retain_bounds_and_negation_in_query_parameters() {
    let definition = Uuid::from_u128(4);
    let end: DateTime<Utc> = "2026-10-21T00:00:00Z".parse().unwrap();
    let range = Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: definition,
        entity_type: None,
        value: PropertyMatchValue::DateRange(DateRange {
            start: None,
            end: Some(end),
        }),
    }));
    let present = Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: definition,
        entity_type: None,
        value: PropertyMatchValue::DatePresent,
    }));
    let params = clause_params(&clauses_of(Expr::or(range, Expr::is_not(present))));
    assert_eq!(params.clause_count, 1);
    assert_eq!(params.clause_indices, vec![0, 0]);
    assert_eq!(params.negated, vec![false, true]);
    assert_eq!(
        params.definition_ids,
        vec![Some(definition), Some(definition)]
    );
    assert_eq!(params.values, vec![None, None]);
    assert_eq!(params.date_terms, vec![true, true]);
    assert_eq!(params.date_starts, vec![None, None]);
    assert_eq!(params.date_ends, vec![Some(end), None]);
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS"
)]
async fn call_date_filters_apply_to_active_and_archived_records(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    use crate::domain::models::CallRecordPage;
    use crate::domain::ports::CallRepository;
    use crate::outbound::pg_call_repo::{
        PgCallRepo,
        test::{CALL_ARCHIVED, CALL1, USER_A},
    };
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    use std::{ops::Deref, sync::Arc};

    let definition = Uuid::from_u128(0x00000001_0000_0000_0000_000000000004);
    sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, 'CALL_RECORD', $3, $4), ($5, $6, 'CALL_RECORD', $3, $7)"#,
        Uuid::now_v7(), CALL1.to_string(), definition,
        serde_json::json!({"type": "Date", "value": "2026-10-20T12:00:00Z"}),
        Uuid::now_v7(), CALL_ARCHIVED.to_string(),
        serde_json::json!({"type": "Date", "value": "2026-10-21T12:00:00Z"})
    ).execute(&pool).await?;
    let repo = PgCallRepo::new(pool.clone());
    let page = CallRecordPage {
        by_start: false,
        after: None,
    };
    let date = |value| {
        Expr::Literal(CallLiteral::Property(PropertiesLiteral {
            property_definition_id: definition,
            entity_type: None,
            value,
        }))
    };
    let boundary: DateTime<Utc> = "2026-10-21T00:00:00Z".parse()?;
    let before = || {
        date(PropertyMatchValue::DateRange(DateRange {
            start: None,
            end: Some(boundary),
        }))
    };
    let after = || {
        date(PropertyMatchValue::DateRange(DateRange {
            start: Some(boundary),
            end: None,
        }))
    };
    for (filter, expected) in [
        (before(), CALL1),
        (after(), CALL_ARCHIVED),
        (Expr::is_not(before()), CALL_ARCHIVED),
        (
            Expr::or(
                before(),
                date(PropertyMatchValue::SelectOption(Uuid::nil())),
            ),
            CALL1,
        ),
    ] {
        let records = repo
            .get_call_records_by_user(USER_A.deref().copied(), 10, &Some(Arc::new(filter)), page)
            .await?;
        assert_eq!(
            records
                .iter()
                .map(|record| record.call_id)
                .collect::<Vec<_>>(),
            vec![expected]
        );
    }
    let stranger = MacroUserIdStr::parse_from_str("macro|no-access@example.test")?;
    assert!(
        repo.get_call_records_by_user(stranger, 10, &Some(Arc::new(before())), page)
            .await?
            .is_empty()
    );

    sqlx::query!(
        "DELETE FROM entity_properties WHERE entity_id = $1 AND property_definition_id = $2",
        CALL1.to_string(),
        definition
    )
    .execute(&pool)
    .await?;
    let missing = Some(Arc::new(Expr::is_not(date(
        PropertyMatchValue::DatePresent,
    ))));
    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &missing, page)
        .await?;
    assert_eq!(
        records
            .iter()
            .map(|record| record.call_id)
            .collect::<Vec<_>>(),
        vec![CALL1]
    );

    sqlx::query!(r#"UPDATE entity_properties SET values = '{"type":"Date","value":null}'::jsonb WHERE entity_id = $1 AND property_definition_id = $2"#, CALL_ARCHIVED.to_string(), definition).execute(&pool).await?;
    let present = Some(Arc::new(date(PropertyMatchValue::DatePresent)));
    assert!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 10, &present, page)
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 10, &missing, page)
            .await?
            .len(),
        2
    );

    sqlx::query!(r#"UPDATE entity_properties SET values = '{"type":"String","value":"not a timestamp"}'::jsonb WHERE entity_id = $1 AND property_definition_id = $2"#, CALL_ARCHIVED.to_string(), definition).execute(&pool).await?;
    assert!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 10, &Some(Arc::new(after())), page)
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 10, &missing, page)
            .await?
            .len(),
        2
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS"
)]
async fn date_filters_include_imported_records_without_broadening_access(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    use crate::domain::{models::CallRecordPage, ports::CallRepository};
    use crate::outbound::pg_call_repo::{
        PgCallRepo,
        test::{USER_A, USER_B},
    };
    use macro_user_id::cowlike::CowLike;
    use std::{ops::Deref, sync::Arc};

    let id = Uuid::now_v7();
    let permission = Uuid::now_v7().to_string();
    let definition = Uuid::from_u128(0x00000001_0000_0000_0000_000000000004);
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "createdAt", "updatedAt") VALUES ($1, now(), now())"#,
        permission
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO call_entities (id, user_id, title, created_via, share_permission_id) VALUES ($1, $2, 'Imported call', 'import', $3)",
        id, USER_A.as_ref(), permission
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'call', $2, 'user', 'owner')",
        id, USER_A.as_ref()
    ).execute(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, 'CALL_RECORD', $3, '{"type":"Date","value":"2026-10-22T12:00:00Z"}'::jsonb)"#,
        Uuid::now_v7(), id.to_string(), definition
    ).execute(&pool).await?;
    let repo = PgCallRepo::new(pool.clone());
    let page = CallRecordPage {
        by_start: false,
        after: None,
    };
    let predicate = |value| {
        Expr::Literal(CallLiteral::Property(PropertiesLiteral {
            property_definition_id: definition,
            entity_type: None,
            value,
        }))
    };
    let filter = |expr| {
        Some(Arc::new(Expr::and(
            Expr::Literal(CallLiteral::CallId(id)),
            expr,
        )))
    };
    for value in [
        PropertyMatchValue::DatePresent,
        PropertyMatchValue::DateRange(DateRange {
            start: Some("2026-10-22T00:00:00Z".parse()?),
            end: Some("2026-10-23T00:00:00Z".parse()?),
        }),
    ] {
        let records = repo
            .get_call_records_by_user(USER_A.deref().copied(), 1, &filter(predicate(value)), page)
            .await?;
        assert_eq!(
            records.iter().map(|row| row.call_id).collect::<Vec<_>>(),
            [id]
        );
    }
    let present = filter(predicate(PropertyMatchValue::DatePresent));
    assert!(
        repo.get_call_records_by_user(USER_B.deref().copied(), 1, &present, page)
            .await?
            .is_empty()
    );
    let outside = filter(predicate(PropertyMatchValue::DateRange(DateRange {
        start: Some("2026-10-23T00:00:00Z".parse()?),
        end: None,
    })));
    assert!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 1, &outside, page)
            .await?
            .is_empty()
    );
    let missing = filter(Expr::is_not(predicate(PropertyMatchValue::DatePresent)));
    assert!(
        repo.get_call_records_by_user(USER_A.deref().copied(), 1, &missing, page)
            .await?
            .is_empty()
    );
    for value in [
        serde_json::json!({"type": "Date", "value": null}),
        serde_json::json!({"type": "String", "value": "not a timestamp"}),
    ] {
        sqlx::query!(
            "UPDATE entity_properties SET values = $1 WHERE entity_id = $2 AND property_definition_id = $3",
            value, id.to_string(), definition
        ).execute(&pool).await?;
        assert!(
            repo.get_call_records_by_user(USER_A.deref().copied(), 1, &present, page)
                .await?
                .is_empty()
        );
        assert_eq!(
            repo.get_call_records_by_user(USER_A.deref().copied(), 1, &missing, page)
                .await?
                .len(),
            1
        );
    }
    Ok(())
}
