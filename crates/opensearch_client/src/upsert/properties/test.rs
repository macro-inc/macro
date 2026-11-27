use super::PropertyUpdate;
use crate::{OpensearchClient, test_support::serve_once};

/// OpenSearch 3.5's answers, as a private node gave them.
const UPDATED: &str = r#"{"_index":"projects","_id":"p1","_version":2,"result":"updated","_shards":{"total":2,"successful":1,"failed":0},"_seq_no":1,"_primary_term":1}"#;
const DOCUMENT_MISSING: &str = r#"{"error":{"root_cause":[{"type":"document_missing_exception","reason":"[p1]: document missing","index":"projects","shard":"0"}],"type":"document_missing_exception","reason":"[p1]: document missing","index":"projects","shard":"0"},"status":404}"#;
const INDEX_MISSING: &str = r#"{"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index [projects]"}],"type":"index_not_found_exception","reason":"no such index [projects]"},"status":404}"#;

/// The property writers, each of which updates one document by id.
#[derive(Debug, Clone, Copy)]
enum Writer {
    Document,
    Chat,
    Project,
    CallRecord,
    CalendarEvent,
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
