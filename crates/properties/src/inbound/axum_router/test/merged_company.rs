//! A merged company's old id through the real HTTP routes, CRM access checks
//! and storage.
use super::crm_contact_access::{contact_router, insert_user};
use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const OWNER: &str = "macro|owner@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";

async fn set_tier(app: &Router, user: &str, company_id: Uuid, tier_id: Uuid) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/entities/COMPANY/{company_id}/{tier_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {user}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({ "value": { "type": "string", "value": "Gold" } })
                        .to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond")
        .status()
}

/// The status and the body of a company's properties.
async fn read(app: &Router, user: &str, company_id: Uuid) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(bearer_request(
            &format!("/entities/COMPANY/{company_id}"),
            user,
        ))
        .await
        .expect("router should respond");
    let status = response.status();
    let body = response_body(response).await;
    (status, serde_json::from_str(&body).unwrap_or_default())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_id_reads_and_writes_the_company_it_was_merged_into(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, tier, survivor, merged, merge) = (
        Uuid::now_v7(),
        Uuid::now_v7(),
        Uuid::now_v7(),
        Uuid::now_v7(),
        Uuid::now_v7(),
    );
    for user in [OWNER, OUTSIDER] {
        insert_user(&pool, user).await?;
    }
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sales', $2)",
        team,
        OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO property_definitions (id, team_id, display_name, data_type, is_multi_select)
         VALUES ($1, $2, 'Tier', 'STRING', false)",
        tier,
        team,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction)
         VALUES ($1, $2, now(), now())",
        survivor,
        team,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_company_merges (
             id, team_id, user_id, request_key, request_fingerprint, survivor_id, source_ids, result
         ) VALUES ($1, $2, $3, $1, '', $4, ARRAY[$5]::uuid[], '{}')",
        merge,
        team,
        OWNER,
        survivor,
        merged,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_company_aliases (retired_id, company_id, merge_id) VALUES ($1, $2, $3)",
        merged,
        survivor,
        merge,
    )
    .execute(&pool)
    .await?;
    let app = contact_router(&pool);

    assert_eq!(
        set_tier(&app, OWNER, merged, tier).await,
        StatusCode::NO_CONTENT
    );
    let stored = sqlx::query_scalar!(
        "SELECT entity_id FROM entity_properties WHERE property_definition_id = $1",
        tier,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(stored, [survivor.to_string()]);
    assert_eq!(
        read(&app, OWNER, merged).await,
        read(&app, OWNER, survivor).await
    );

    for company in [merged, survivor] {
        assert_eq!(read(&app, OUTSIDER, company).await.0, StatusCode::FORBIDDEN);
        assert_eq!(
            set_tier(&app, OUTSIDER, company, tier).await,
            StatusCode::FORBIDDEN
        );
    }
    Ok(())
}
