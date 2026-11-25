//! A merged company's old id, over the CRM's HTTP routes with the real access
//! checks and storage, for each role on the team and a caller outside it.

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    helpers::insert_company_alias,
    previews::{MEMBER, OUTSIDER, OWNER, app, send},
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn an_old_id_previews_and_reads_the_company_it_was_merged_into(pool: PgPool) {
    let visible = Uuid::from_u128(101);
    let hidden = Uuid::from_u128(106);
    let (into_visible, into_hidden) = (Uuid::now_v7(), Uuid::now_v7());
    insert_company_alias(&pool, into_visible, visible).await;
    insert_company_alias(&pool, into_hidden, hidden).await;
    let app = app(pool);
    let requested = [into_visible, into_hidden, visible];

    for (user, opens_visible, opens_hidden) in [
        (OWNER, true, true),
        (MEMBER, true, false),
        (OUTSIDER, false, false),
    ] {
        let (status, previews) = send(
            &app,
            user,
            "/previews",
            Some(json!({ "companyIds": requested })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{user}");
        let answers = previews["companies"].as_array().unwrap();
        let answer = |id: Uuid| answers.iter().find(|answer| answer["id"] == json!(id));

        for (old_id, company, opens) in [
            (into_visible, visible, opens_visible),
            (into_hidden, hidden, opens_hidden),
        ] {
            let (status, read) = send(&app, user, &format!("/companies/{old_id}"), None).await;
            let Some(preview) = answer(old_id) else {
                assert!(!opens, "{user} {old_id}");
                assert_eq!(status, StatusCode::UNAUTHORIZED, "{user} {old_id}");
                continue;
            };
            assert!(opens, "{user} {old_id}");
            assert_eq!(preview["mergedInto"], json!(company), "{user}");
            assert_eq!(status, StatusCode::OK, "{user} {old_id}");
            assert_eq!(read["id"], json!(company), "{user}");
            assert_eq!(preview["name"], read["name"], "{user}");
            assert_eq!(preview["updatedAt"], read["updatedAt"], "{user}");
        }

        if let Some(preview) = answer(visible) {
            assert!(preview.get("mergedInto").is_none(), "{user}");
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn a_contact_moved_to_an_old_id_joins_the_company_it_was_merged_into(pool: PgPool) {
    let (into_visible, into_foreign) = (Uuid::now_v7(), Uuid::now_v7());
    insert_company_alias(&pool, into_visible, Uuid::from_u128(105)).await;
    insert_company_alias(&pool, into_foreign, Uuid::from_u128(201)).await;
    let contact = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_contacts (id, team_id, name, first_interaction, last_interaction)
         VALUES ($1, $2, 'By name', now(), now())",
    )
    .bind(contact)
    .bind(Uuid::from_u128(0xa))
    .execute(&pool)
    .await
    .unwrap();
    let app = app(pool);
    let put = async |company: Uuid| {
        let response = app
            .clone()
            .oneshot(
                Request::put(format!("/contacts/{contact}/company"))
                    .header("authorization", format!("Bearer {MEMBER}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "companyId": company }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or_default();
        (status, body)
    };

    // Another team's company stays as unavailable through an old id.
    let (status, _) = put(into_foreign).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, moved) = put(into_visible).await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(moved["companyId"], json!(Uuid::from_u128(105)));
}
