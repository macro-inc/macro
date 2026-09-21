use super::*;

#[tokio::test]
async fn document_queries_call_only_the_read_only_domain_port() {
    let (context, calls) = context(FakeAccess::denying());
    let response = ReadOnlyQueryDatabase {
        sql: "SELECT COUNT(*) FROM guests".into(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    let calls = calls.lock().unwrap();
    assert!(calls.executed.is_empty());
    assert_eq!(calls.queried, ["SELECT COUNT(*) FROM guests"]);
    assert_eq!(response.changes_applied, 0);
    assert_eq!(response.results[0].rows[0][0], 12);
    assert_eq!(response.read_versions[0].table_id, TABLE_ID);
    assert!(response.inserted_row_ids.is_empty());
}

#[tokio::test]
async fn rejected_write_never_falls_back_to_interactive_execution() {
    let context = failing_sql_context("table guests is read-only");
    let calls = context.service.calls.clone();
    let error = ReadOnlyQueryDatabase {
        sql: "DELETE FROM guests".into(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap_err();
    assert!(error.description.contains("read-only"));
    assert!(calls.lock().unwrap().executed.is_empty());
    assert_eq!(calls.lock().unwrap().queried, ["DELETE FROM guests"]);
}
