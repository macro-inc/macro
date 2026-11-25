use crate::{
    OpensearchClient,
    date_format::EpochMillis,
    error::{OpensearchClientError, OpensearchOperation, WriteRefusal},
    test_support::serve_once,
    upsert::{
        call_record::UpsertCallRecordSegmentArgs,
        document::UpsertDocumentArgs,
        email::{EmailDocumentKey, EmailWrites, UpsertEmailArgs},
    },
};

/// A saturated node's answer, as a private OpenSearch with a one-slot write
/// queue gave it: HTTP 200, one item written and one refused.
const REFUSED_ITEM: &str = r#"{"took":14,"errors":true,"items":[
{"index":{"_index":"emails_v1","_id":"thread-1:message-1","_version":1,"result":"created","status":201}},
{"index":{"_index":"emails_v1","_id":"thread-1:message-2","status":429,"error":{"type":"rejected_execution_exception","reason":"rejected execution of TransportWriteAction on OpenSearchThreadPoolExecutor[name = node/write, queue capacity = 1]"}}}]}"#;

/// A mapping error inside an otherwise successful bulk, as OpenSearch gave it.
const MAPPING_ERROR_ITEM: &str = r#"{"took":182,"errors":true,"items":[
{"index":{"_index":"emails_v1","_id":"thread-1:message-1","_version":1,"result":"created","status":201}},
{"index":{"_index":"emails_v1","_id":"thread-1:message-2","status":400,"error":{"type":"mapper_parsing_exception","reason":"failed to parse field [sent_at_millis] of type [long]"}}}]}"#;

const ALL_WRITTEN: &str = r#"{"took":3,"errors":false,"items":[
{"index":{"_id":"thread-1:message-1","result":"created","status":201}},
{"index":{"_id":"thread-1:message-2","result":"updated","status":200}}]}"#;

/// A versioned bulk answered by OpenSearch 3.5 where the index held version
/// 200 of `message-1`: the stale write and delete of it at 100 are refused,
/// `message-2` is written, and the delete of `message-3`, never indexed, finds
/// nothing.
const STALE_ITEMS: &str = r#"{"took":8,"errors":true,"items":[
{"index":{"_index":"emails_v1","_id":"thread-1:message-1","status":409,"error":{"type":"version_conflict_engine_exception","reason":"[thread-1:message-1]: version conflict, current version [200] is higher than the one provided [100]","index":"emails_v1","shard":"0"}}},
{"index":{"_index":"emails_v1","_id":"thread-1:message-2","_version":100,"result":"created","status":201}},
{"delete":{"_index":"emails_v1","_id":"thread-1:message-3","_version":100,"result":"not_found","status":404}},
{"delete":{"_index":"emails_v1","_id":"thread-1:message-1","status":409,"error":{"type":"version_conflict_engine_exception","reason":"[thread-1:message-1]: version conflict, current version [200] is higher than the one provided [100]","index":"emails_v1","shard":"0"}}}]}"#;

fn client(url: String) -> OpensearchClient {
    OpensearchClient::new(url, "".into(), "".into()).unwrap()
}

fn email(message_id: &str) -> UpsertEmailArgs {
    UpsertEmailArgs {
        thread_id: "thread-1".to_owned(),
        message_id: message_id.to_owned(),
        sender: String::new(),
        sender_name: None,
        reply_to: None,
        recipients: vec![],
        recipient_names: vec![],
        cc: vec![],
        cc_names: vec![],
        bcc: vec![],
        bcc_names: vec![],
        labels: vec![],
        link_id: "link-1".to_owned(),
        user_id: "user-1".to_owned(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        subject: None,
        sent_at_millis: None,
        content: "Body".to_owned(),
        properties: vec![],
    }
}

fn segment(transcript_id: &str) -> UpsertCallRecordSegmentArgs {
    UpsertCallRecordSegmentArgs {
        call_id: "call-1".to_owned(),
        transcript_id: transcript_id.to_owned(),
        channel_id: None,
        participant_ids: vec![],
        channel_name: None,
        name: None,
        speaker_id: "speaker-1".to_owned(),
        sequence_num: 1,
        content: "Hello".to_owned(),
        started_at_millis: EpochMillis::new(10).unwrap(),
        ended_at_millis: None,
        properties: vec![],
    }
}

fn chunk(node_id: &str) -> UpsertDocumentArgs {
    UpsertDocumentArgs {
        document_id: "document-1".to_owned(),
        node_id: node_id.to_owned(),
        document_name: "Notes".to_owned(),
        file_type: "md".to_owned(),
        owner_id: "user-1".to_owned(),
        raw_content: None,
        content: "Body".to_owned(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        sub_type: None,
        properties: vec![],
        is_email_attachment: false,
    }
}

fn assert_refused_item(result: &Result<impl std::fmt::Debug, OpensearchClientError>) {
    assert!(
        matches!(
            result,
            Err(OpensearchClientError::BulkItemsFailed {
                failed: 1,
                total: 2,
                refusal: Some(WriteRefusal::TooManyRequests),
                ..
            })
        ),
        "a refused item must fail the call: {result:?}"
    );
}

#[tokio::test]
async fn an_email_bulk_with_a_refused_item_fails() {
    let (url, server) = serve_once("200 OK", REFUSED_ITEM);

    let result = client(url)
        .write_email_documents(1, &[email("message-1"), email("message-2")], &[], None)
        .await;
    server.join().unwrap();

    assert_refused_item(&result);
}

#[tokio::test]
async fn an_email_bulk_with_a_mapping_error_fails_without_a_refusal() {
    let (url, server) = serve_once("200 OK", MAPPING_ERROR_ITEM);

    let result = client(url)
        .write_email_documents(1, &[email("message-1"), email("message-2")], &[], None)
        .await;
    server.join().unwrap();

    let Err(OpensearchClientError::BulkItemsFailed {
        failed,
        total,
        refusal,
        errors,
        operation,
    }) = result
    else {
        panic!("a failed item must fail the call: {result:?}");
    };
    assert_eq!((failed, total, refusal), (1, 2, None));
    assert_eq!(operation, OpensearchOperation::WriteEmailDocuments);
    assert_eq!(
        errors,
        ["mapper_parsing_exception: failed to parse field [sent_at_millis] of type [long]"]
    );
}

#[tokio::test]
async fn a_call_segment_bulk_with_a_refused_item_fails() {
    let (url, server) = serve_once("200 OK", REFUSED_ITEM);

    let result = client(url)
        .bulk_upsert_call_record_segments(&[segment("transcript-1")], None)
        .await;
    server.join().unwrap();

    assert_refused_item(&result);
}

#[tokio::test]
async fn a_single_call_segment_with_a_refused_item_fails() {
    let (url, server) = serve_once("200 OK", REFUSED_ITEM);

    let result = client(url)
        .upsert_call_record_segment(&segment("transcript-1"), None)
        .await;
    server.join().unwrap();

    assert_refused_item(&result);
}

#[tokio::test]
async fn a_document_chunk_bulk_with_a_refused_item_fails() {
    let (url, server) = serve_once("200 OK", REFUSED_ITEM);

    let result = client(url)
        .bulk_upsert_documents(&[chunk("node-1")], None)
        .await;
    server.join().unwrap();

    assert_refused_item(&result);
}

#[tokio::test]
async fn a_bulk_whose_items_all_succeed_counts_them() {
    let (url, server) = serve_once("200 OK", ALL_WRITTEN);

    let result = client(url)
        .write_email_documents(1, &[email("message-1"), email("message-2")], &[], None)
        .await
        .unwrap();
    server.join().unwrap();

    assert_eq!(result.indexed, 2);
}

#[tokio::test]
async fn a_refused_bulk_request_is_a_write_refusal() {
    let (url, server) = serve_once(
        "429 Too Many Requests",
        r#"{"error":{"type":"rejected_execution_exception","reason":"rejected"},"status":429}"#,
    );

    let result = client(url)
        .write_email_documents(1, &[email("message-1")], &[], None)
        .await;
    server.join().unwrap();

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::WritesRefused {
                cause: WriteRefusal::TooManyRequests,
                operation: OpensearchOperation::WriteEmailDocuments,
                ..
            })
        ),
        "{result:?}"
    );
}

fn deleted(thread_id: &str, message_id: &str) -> EmailDocumentKey {
    EmailDocumentKey {
        thread_id: thread_id.to_owned(),
        message_id: message_id.to_owned(),
    }
}

#[tokio::test]
async fn a_versioned_email_write_fences_every_action_with_its_version() {
    let (url, server) = serve_once("200 OK", ALL_WRITTEN);

    client(url)
        .write_email_documents(
            1_764_000_000_000_000,
            &[email("message-1")],
            &[deleted("thread-2", "message-2")],
            None,
        )
        .await
        .unwrap();
    let (request_line, body) = server.join().unwrap();

    assert!(
        request_line.starts_with("POST /emails/_bulk "),
        "{request_line}"
    );
    let lines: Vec<serde_json::Value> = body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 3, "{body}");
    assert_eq!(
        lines[0],
        serde_json::json!({"index": {
            "_id": "thread-1:message-1",
            "version": 1_764_000_000_000_000_i64,
            "version_type": "external_gte",
        }})
    );
    assert_eq!(lines[1]["entity_id"], "thread-1");
    assert_eq!(
        lines[2],
        serde_json::json!({"delete": {
            "_id": "thread-2:message-2",
            "version": 1_764_000_000_000_000_i64,
            "version_type": "external_gte",
        }})
    );
}

#[tokio::test]
async fn stale_writes_are_refused_not_failed_and_an_absent_delete_is_done() {
    let (url, server) = serve_once("200 OK", STALE_ITEMS);

    let writes = client(url)
        .write_email_documents(
            100,
            &[email("message-1"), email("message-2")],
            &[
                deleted("thread-1", "message-3"),
                deleted("thread-1", "message-1"),
            ],
            None,
        )
        .await
        .unwrap();
    server.join().unwrap();

    assert_eq!(
        writes,
        EmailWrites {
            indexed: 1,
            deleted: 1,
            refused_stale: 2,
        }
    );
}

#[tokio::test]
async fn a_versioned_email_write_with_a_refused_item_still_fails() {
    let (url, server) = serve_once("200 OK", REFUSED_ITEM);

    let result = client(url)
        .write_email_documents(1, &[email("message-1"), email("message-2")], &[], None)
        .await;
    server.join().unwrap();

    assert_refused_item(&result);
}

#[tokio::test]
async fn an_empty_versioned_email_write_sends_nothing() {
    let writes = client("http://127.0.0.1:9".to_owned())
        .write_email_documents(1, &[], &[], None)
        .await
        .unwrap();

    assert_eq!(writes, EmailWrites::default());
}

#[test]
fn an_unversioned_bulk_still_fails_on_a_version_conflict() {
    let result =
        super::classify_bulk_response(200, STALE_ITEMS, OpensearchOperation::UpsertDocument);

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::BulkItemsFailed {
                failed: 3,
                total: 4,
                ..
            })
        ),
        "{result:?}"
    );
}

#[test]
fn a_bulk_answer_that_is_not_an_object_fails_instead_of_panicking() {
    let result = super::classify_versioned_bulk_response(
        200,
        "[]",
        OpensearchOperation::WriteEmailDocuments,
    );

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::DeserializationFailed { .. })
        ),
        "{result:?}"
    );
}

/// A mapping error quotes the start of the value it could not parse, which
/// can be a message's text; the error keeps the field and the problem only.
#[test]
fn a_failed_item_s_error_leaves_out_the_value_it_quotes() {
    let body = r#"{"took":1,"errors":true,"items":[{"index":{"_id":"thread-1:message-1","status":400,"error":{"type":"mapper_parsing_exception","reason":"failed to parse field [sent_at_millis] of type [long] in document with id 'thread-1:message-1'. Preview of field's value: 'private words'"}}}]}"#;

    let result = super::classify_versioned_bulk_response(
        200,
        body,
        OpensearchOperation::WriteEmailDocuments,
    );

    let Err(OpensearchClientError::BulkItemsFailed { errors, .. }) = result else {
        panic!("a failed item must fail the call: {result:?}");
    };
    assert_eq!(
        errors,
        [
            "mapper_parsing_exception: failed to parse field [sent_at_millis] of type [long] in document with id 'thread-1:message-1'"
        ]
    );
}

#[test]
fn a_bulk_answer_without_items_acknowledges_nothing() {
    let result = super::classify_bulk_response(
        200,
        r#"{"took":1,"errors":false}"#,
        OpensearchOperation::WriteEmailDocuments,
    );

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::DeserializationFailed { .. })
        ),
        "{result:?}"
    );
}

#[test]
fn refusals_are_read_from_the_bodies_other_requests_fail_with() {
    let unknown = |details: &str| OpensearchClientError::Unknown {
        details: details.to_owned(),
        operation: OpensearchOperation::UpsertChatMessageChild,
    };

    assert_eq!(
        unknown(r#"{"error":{"type":"rejected_execution_exception"},"status":429}"#).refusal(),
        Some(WriteRefusal::TooManyRequests)
    );
    assert_eq!(
        unknown(r#"{"error":{"type":"circuit_breaking_exception"},"status":429}"#).refusal(),
        Some(WriteRefusal::TooManyRequests)
    );
    assert_eq!(
        unknown(r#"{"error":{"type":"cluster_block_exception"},"status":403}"#).refusal(),
        Some(WriteRefusal::ClusterBlock)
    );
    assert_eq!(
        unknown(r#"{"deleted":0,"failures":[{"status":429,"cause":{"type":"rejected_execution_exception"}}]}"#)
            .refusal(),
        Some(WriteRefusal::TooManyRequests)
    );
    // `parse_deleted_by_query` and the update-by-query path keep the list alone.
    assert_eq!(
        unknown(r#"[{"index":"emails_v1","status":429,"cause":{"type":"rejected_execution_exception"}}]"#)
            .refusal(),
        Some(WriteRefusal::TooManyRequests)
    );
    assert_eq!(
        unknown(r#"[{"status":409,"cause":{"type":"version_conflict_engine_exception"}}]"#)
            .refusal(),
        None
    );
    assert_eq!(
        unknown(r#"{"error":{"type":"mapper_parsing_exception"},"status":400}"#).refusal(),
        None
    );
    assert_eq!(unknown("not json").refusal(), None);
    assert_eq!(
        OpensearchClientError::NetworkError {
            status_code: 429,
            message: String::new(),
        }
        .refusal(),
        Some(WriteRefusal::TooManyRequests)
    );
}
