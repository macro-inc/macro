//! A merged contact's old id through the real HTTP routes, CRM access checks
//! and storage.
use super::crm_contact_access::{contact_router, insert_user};
use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const OWNER: &str = "macro|owner@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";

async fn set_phone(app: &Router, user: &str, contact_id: Uuid, phone_id: Uuid) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/entities/CONTACT/{contact_id}/{phone_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {user}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({ "value": { "type": "string", "value": "555-0100" } })
                        .to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond")
        .status()
}

/// The status and the body of a contact's properties.
async fn read(app: &Router, user: &str, contact_id: Uuid) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(bearer_request(
            &format!("/entities/CONTACT/{contact_id}"),
            user,
        ))
        .await
        .expect("router should respond");
    let status = response.status();
    let body = response_body(response).await;
    (status, serde_json::from_str(&body).unwrap_or_default())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_id_reads_and_writes_the_contact_it_was_merged_into(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, phone, survivor, merged, merge) = (
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
         VALUES ($1, $2, 'Phone', 'STRING', false)",
        phone,
        team,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_contacts (id, team_id, name, first_interaction, last_interaction)
         VALUES ($1, $2, 'Ada', now(), now())",
        survivor,
        team,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_merges (
             id, team_id, user_id, record_type, request_key, request_fingerprint, survivor_id, source_ids, result
         ) VALUES ($1, $2, $3, 'contact', $1, '', $4, ARRAY[$5]::uuid[], '{}')",
        merge,
        team,
        OWNER,
        survivor,
        merged,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_contact_aliases (retired_id, contact_id, merge_id) VALUES ($1, $2, $3)",
        merged,
        survivor,
        merge,
    )
    .execute(&pool)
    .await?;
    let app = contact_router(&pool);

    assert_eq!(
        set_phone(&app, OWNER, merged, phone).await,
        StatusCode::NO_CONTENT
    );
    let stored = sqlx::query_scalar!(
        "SELECT entity_id FROM entity_properties WHERE property_definition_id = $1",
        phone,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(stored, [survivor.to_string()]);
    let phone_value = |body: &serde_json::Value| {
        body["properties"]
            .as_array()
            .and_then(|properties| {
                properties
                    .iter()
                    .find(|property| property["definition"]["id"] == phone.to_string())
            })
            .map(|property| property["value"]["value"].clone())
    };
    for contact in [merged, survivor] {
        let (status, body) = read(&app, OWNER, contact).await;
        assert_eq!(status, StatusCode::OK, "{contact}");
        assert_eq!(
            phone_value(&body),
            Some(serde_json::json!("555-0100")),
            "{contact}"
        );
    }
    assert_eq!(
        read(&app, OWNER, merged).await,
        read(&app, OWNER, survivor).await
    );

    for contact in [merged, survivor] {
        assert_eq!(read(&app, OUTSIDER, contact).await.0, StatusCode::FORBIDDEN);
        assert_eq!(
            set_phone(&app, OUTSIDER, contact, phone).await,
            StatusCode::FORBIDDEN
        );
    }
    Ok(())
}
