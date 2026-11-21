use super::*;
use crate::process::test_support::fake_opensearch;

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn an_event_for_a_call_that_is_gone_removes_it_from_search(pool: sqlx::PgPool) {
    let call_id = Uuid::now_v7();
    let (opensearch, requests) = fake_opensearch().await;

    process_call_record(&opensearch, &pool, call_id, None)
        .await
        .unwrap();

    let requests = requests.lock().unwrap().clone();
    assert_eq!(
        requests
            .iter()
            .map(|(line, _)| line.as_str())
            .collect::<Vec<_>>(),
        [
            "GET /call_records/_refresh",
            "POST /call_records/_delete_by_query"
        ]
    );
    assert!(requests[1].1.contains(&call_id.to_string()), "{requests:?}");
}
