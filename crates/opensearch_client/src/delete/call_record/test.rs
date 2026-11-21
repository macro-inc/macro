use crate::{
    OpensearchClient,
    date_format::EpochMillis,
    test_support::{LOCAL_OPENSEARCH, count, delete_index, refresh, scratch_index_like},
    upsert::call_record::UpsertCallRecordSegmentArgs,
};

const USER: &str = "macro|call-delete-test@example.com";

fn segment(call_id: &str, channel_id: &str, transcript_id: &str) -> UpsertCallRecordSegmentArgs {
    UpsertCallRecordSegmentArgs {
        call_id: call_id.to_owned(),
        transcript_id: transcript_id.to_owned(),
        channel_id: Some(channel_id.to_owned()),
        participant_ids: vec![USER.to_owned()],
        channel_name: Some("Standup".to_owned()),
        name: Some("Standup".to_owned()),
        speaker_id: USER.to_owned(),
        sequence_num: 0,
        content: "zebrafish migration notes".to_owned(),
        started_at_millis: EpochMillis::new(1_700_000_000_000).unwrap(),
        ended_at_millis: Some(EpochMillis::new(1_700_000_100_000).unwrap()),
        properties: vec![],
    }
}

/// A call's documents: the call and every segment under it.
async fn call_documents(
    client: &opensearch::OpenSearch,
    index: &str,
    call_id: &str,
) -> anyhow::Result<u64> {
    count(
        client,
        index,
        serde_json::json!({"bool": {"should": [
            {"term": {"entity_id": call_id}},
            {"parent_id": {"type": "segment", "id": call_id}}
        ]}}),
    )
    .await
}

/// Three calls of two segments each, two in one channel, and a segment of each
/// deleted call written just before the deletes; one call is deleted by id
/// and the other channel's calls by channel. Nothing of the deleted
/// calls is left.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200 with the search indices created"]
async fn a_deleted_call_or_channel_leaves_no_documents_behind() {
    let client = OpensearchClient::new(LOCAL_OPENSEARCH.into(), "".into(), "".into()).unwrap();
    let index = scratch_index_like(&client, "call_records", "call-delete-test")
        .await
        .unwrap();
    let os = &client.inner;

    let observed: anyhow::Result<_> = async {
        let segments = [
            ("call-1", "channel-a", "segment-1"),
            ("call-1", "channel-a", "segment-2"),
            ("call-2", "channel-a", "segment-3"),
            ("call-2", "channel-a", "segment-4"),
            ("call-3", "channel-b", "segment-5"),
            ("call-3", "channel-b", "segment-6"),
        ]
        .map(|(call_id, channel_id, transcript_id)| segment(call_id, channel_id, transcript_id));
        client
            .bulk_upsert_call_record_segments(&segments, Some(&index))
            .await?;
        refresh(os, &index).await?;
        let indexed = call_documents(os, &index, "call-1").await?;
        // Written after the refresh: no search sees these until the next one.
        client
            .bulk_upsert_call_record_segments(
                &[
                    segment("call-1", "channel-a", "segment-7"),
                    segment("call-3", "channel-b", "segment-8"),
                ],
                Some(&index),
            )
            .await?;

        let call_delete = client.delete_call_record("call-1", Some(&index)).await;
        let channel_delete = client
            .delete_call_records_by_channel("channel-b", Some(&index))
            .await;
        refresh(os, &index).await?;
        Ok((
            indexed,
            call_delete.map_err(|error| error.to_string()),
            channel_delete.map_err(|error| error.to_string()),
            call_documents(os, &index, "call-1").await?,
            call_documents(os, &index, "call-2").await?,
            call_documents(os, &index, "call-3").await?,
        ))
    }
    .await;

    delete_index(os, &index).await;
    assert_eq!(
        observed.unwrap(),
        (3, Ok(()), Ok(()), 0, 3, 0),
        "(call-1 indexed, call delete, channel delete, call-1, call-2, call-3 documents)"
    );
}
