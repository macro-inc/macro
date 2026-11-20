use super::*;

type Requests = std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>;

/// Stands in for OpenSearch: records each request as `METHOD path` with its
/// body and accepts every update.
async fn fake_opensearch() -> (OpensearchClient, Requests) {
    use axum::{
        Json,
        body::Bytes,
        http::{Method, Uri},
    };

    let requests = Requests::default();
    let recorded = requests.clone();
    let app = axum::Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let recorded = recorded.clone();
        async move {
            recorded.lock().unwrap().push((
                format!("{method} {}", uri.path()),
                String::from_utf8_lossy(&body).into_owned(),
            ));
            Json(serde_json::json!({ "result": "updated" }))
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        OpensearchClient::new(endpoint, String::new(), String::new()).unwrap(),
        requests,
    )
}

/// The system Project property, seeded by the migrations.
const PROJECT_PROPERTY: uuid::Uuid = uuid::Uuid::from_u128(0x00000001_0000_0000_0000_000000000014);

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn a_calendar_events_property_change_reaches_its_search_document(pool: sqlx::PgPool) {
    let event_id = "01980000-0000-7000-8000-00000000ca1e";
    let project_id = "01980000-0000-7000-8000-000000000001";
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (
            gen_random_uuid(),
            $1,
            'CALENDAR_EVENT',
            $2,
            jsonb_build_object(
                'type', 'EntityReference',
                'value', jsonb_build_array(jsonb_build_object(
                    'entity_id', $3::text,
                    'entity_type', 'INITIATIVE'
                ))
            )
        )
        "#,
        event_id,
        PROJECT_PROPERTY,
        project_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (opensearch, requests) = fake_opensearch().await;

    let update =
        process_entity_property_update(&opensearch, &pool, event_id, EntityType::CalendarEvent)
            .await
            .unwrap();

    assert_eq!(update, PropertyRefresh::Written);

    let requests = requests.lock().unwrap().clone();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.as_str())
            .collect::<Vec<_>>(),
        [format!("POST /calendar_events/_update/{event_id}")],
    );
    let body: serde_json::Value = serde_json::from_str(&requests[0].1).unwrap();
    assert_eq!(
        body["doc"]["properties"],
        serde_json::json!([{
            "definition_id": PROJECT_PROPERTY.to_string(),
            "values": [project_id],
        }])
    );
}
