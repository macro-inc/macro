use super::PropertyUpdate;
use crate::{OpensearchClient, test_support::serve_once};

/// OpenSearch 3.5's answers, as a private node gave them.
const UPDATED: &str = r#"{"_index":"projects","_id":"p1","_version":2,"result":"updated","_shards":{"total":2,"successful":1,"failed":0},"_seq_no":1,"_primary_term":1}"#;
const DOCUMENT_MISSING: &str = r#"{"error":{"root_cause":[{"type":"document_missing_exception","reason":"[p1]: document missing","index":"projects","shard":"0"}],"type":"document_missing_exception","reason":"[p1]: document missing","index":"projects","shard":"0"},"status":404}"#;
const THREAD_MATCHED: &str = r#"{"took":161,"timed_out":false,"total":1,"updated":1,"deleted":0,"batches":1,"version_conflicts":0,"noops":0,"retries":{"bulk":0,"search":0},"throttled_millis":0,"requests_per_second":-1.0,"throttled_until_millis":0,"failures":[]}"#;
const THREAD_UNMATCHED: &str = r#"{"took":2,"timed_out":false,"total":0,"updated":0,"deleted":0,"batches":0,"version_conflicts":0,"noops":0,"retries":{"bulk":0,"search":0},"throttled_millis":0,"requests_per_second":-1.0,"throttled_until_millis":0,"failures":[]}"#;
const INDEX_MISSING: &str = r#"{"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index [projects]"}],"type":"index_not_found_exception","reason":"no such index [projects]"},"status":404}"#;

/// The property writers: every one but the email thread's updates one
/// document by id.
#[derive(Debug, Clone, Copy)]
enum Writer {
    Document,
    Chat,
    Project,
    CallRecord,
    CalendarEvent,
    EmailThread,
}

const SINGLE_DOCUMENT_WRITERS: [Writer; 5] = [
    Writer::Document,
    Writer::Chat,
    Writer::Project,
    Writer::CallRecord,
    Writer::CalendarEvent,
];

async fn write(
    writer: Writer,
    status: &'static str,
    body: &'static str,
) -> crate::Result<PropertyUpdate> {
    let (url, server) = serve_once(status, body);
    let client = OpensearchClient::new(url, "".into(), "".into()).unwrap();
    let result = match writer {
        Writer::Document => client.update_document_properties("p1", &[]).await,
        Writer::Chat => client.update_chat_properties("p1", &[]).await,
        Writer::Project => client.update_project_properties("p1", &[]).await,
        Writer::CallRecord => client.update_call_record_properties("p1", &[]).await,
        Writer::CalendarEvent => client.update_calendar_event_properties("p1", &[]).await,
        Writer::EmailThread => client.update_email_thread_properties("p1", &[]).await,
    };
    server.join().unwrap();
    result
}

#[tokio::test]
async fn a_property_write_reports_a_document_the_index_does_not_hold() {
    for writer in SINGLE_DOCUMENT_WRITERS {
        assert_eq!(
            write(writer, "200 OK", UPDATED).await.unwrap(),
            PropertyUpdate::Applied,
            "{writer:?}"
        );
        assert_eq!(
            write(writer, "404 Not Found", DOCUMENT_MISSING)
                .await
                .unwrap(),
            PropertyUpdate::NotIndexed,
            "{writer:?}"
        );
    }
}

#[tokio::test]
async fn a_property_write_to_a_missing_index_fails() {
    for writer in SINGLE_DOCUMENT_WRITERS {
        assert!(
            write(writer, "404 Not Found", INDEX_MISSING).await.is_err(),
            "{writer:?}"
        );
    }
}

#[tokio::test]
async fn an_email_thread_property_write_reports_a_thread_with_no_indexed_message() {
    assert_eq!(
        write(Writer::EmailThread, "200 OK", THREAD_MATCHED)
            .await
            .unwrap(),
        PropertyUpdate::Applied
    );
    assert_eq!(
        write(Writer::EmailThread, "200 OK", THREAD_UNMATCHED)
            .await
            .unwrap(),
        PropertyUpdate::NotIndexed
    );
}
