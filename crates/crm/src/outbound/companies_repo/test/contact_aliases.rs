//! A merged contact's old id, over the CRM's HTTP routes with the real access
//! checks and storage, for each role on the team and a caller outside it.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    helpers::insert_contact_alias,
    previews::{MEMBER, OUTSIDER, OWNER, app, send},
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn an_old_id_previews_and_reads_the_contact_it_was_merged_into(pool: PgPool) {
    let visible = Uuid::from_u128(1001);
    let hidden = Uuid::from_u128(1003);
    let under_hidden_company = Uuid::from_u128(1002);
    let (into_visible, into_hidden, into_under_hidden_company) =
        (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    insert_contact_alias(&pool, into_visible, visible).await;
    insert_contact_alias(&pool, into_hidden, hidden).await;
    insert_contact_alias(&pool, into_under_hidden_company, under_hidden_company).await;
    let app = app(pool);
    let requested = [
        into_visible,
        into_hidden,
        into_under_hidden_company,
        visible,
    ];

    for (user, opens_visible, opens_hidden) in [
        (OWNER, true, true),
        (MEMBER, true, false),
        (OUTSIDER, false, false),
    ] {
        let (status, previews) = send(
            &app,
            user,
            "/previews",
            Some(json!({ "contactIds": requested })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{user}");
        let answers = previews["contacts"].as_array().unwrap();
        let answer = |id: Uuid| answers.iter().find(|answer| answer["id"] == json!(id));

        for (old_id, contact, opens) in [
            (into_visible, visible, opens_visible),
            (into_hidden, hidden, opens_hidden),
            (into_under_hidden_company, under_hidden_company, opens_hidden),
        ] {
            let (status, read) = send(&app, user, &format!("/contacts/{old_id}"), None).await;
            let Some(preview) = answer(old_id) else {
                assert!(!opens, "{user} {old_id}");
                assert_eq!(status, StatusCode::UNAUTHORIZED, "{user} {old_id}");
                continue;
            };
            assert!(opens, "{user} {old_id}");
            assert_eq!(preview["mergedInto"], json!(contact), "{user}");
            assert_eq!(status, StatusCode::OK, "{user} {old_id}");
            assert_eq!(read["id"], json!(contact), "{user}");
            assert_eq!(preview["name"], read["name"], "{user}");
            assert_eq!(preview["email"], read["email"], "{user}");
            assert_eq!(preview["updatedAt"], read["updatedAt"], "{user}");
        }

        if let Some(preview) = answer(visible) {
            assert!(preview.get("mergedInto").is_none(), "{user}");
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn an_edit_through_an_old_id_changes_the_contact_it_was_merged_into(pool: PgPool) {
    let survivor = Uuid::from_u128(1001);
    let foreign = Uuid::from_u128(2001);
    let (into_survivor, into_foreign) = (Uuid::now_v7(), Uuid::now_v7());
    insert_contact_alias(&pool, into_survivor, survivor).await;
    insert_contact_alias(&pool, into_foreign, foreign).await;
    let app = app(pool);
    let rename = async |contact: Uuid, name: &str| {
        app.clone()
            .oneshot(
                Request::put(format!("/contacts/{contact}/name"))
                    .header("authorization", format!("Bearer {MEMBER}"))
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "name": name }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    };

    // Another team's contact stays unavailable through an old id.
    assert_eq!(
        rename(into_foreign, "Renamed").await,
        StatusCode::UNAUTHORIZED
    );

    assert_eq!(
        rename(into_survivor, "Pat Merged").await,
        StatusCode::NO_CONTENT
    );
    let (status, read) = send(&app, MEMBER, &format!("/contacts/{survivor}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read["name"], "Pat Merged");
    let (_, foreign_read) = send(&app, OUTSIDER, &format!("/contacts/{foreign}"), None).await;
    assert_eq!(foreign_read["name"], "Other Contact");
}
