use super::*;
use serde_json::json;

fn args() -> UpsertChannelMessageArgs {
    let message_id = uuid::Uuid::now_v7().to_string();
    UpsertChannelMessageArgs {
        channel_id: uuid::Uuid::now_v7().to_string(),
        channel_type: "private".into(),
        org_id: None,
        message_id: message_id.clone(),
        thread_id: message_id,
        sender_id: "macro|system@macro.com".into(),
        imported_author: Some("quartzarchivebot".into()),
        mentions: vec![],
        content: "Historical message body".into(),
        created_at_millis: EpochMillis::new(1_600_000_000_123).unwrap(),
        updated_at_millis: EpochMillis::new(1_600_000_000_123).unwrap(),
    }
}

#[test]
fn author_is_text_not_content_or_sender() {
    let mut args = args();
    for author in [Some("quartzarchivebot".to_owned()), None] {
        args.imported_author = author.clone();
        let value = serde_json::to_value(&args).unwrap();
        assert_eq!(value["imported_author"], json!(author));
        assert_eq!(value["content"], "Historical message body");
        assert_eq!(value["sender_id"], "macro|system@macro.com");
        assert_eq!(value["entity_id"], args.channel_id);
        assert_eq!(value["message_id"], args.message_id);
    }
}

/// Scratch-index integration of copy_to with the production access/sender query.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn imported_author_matches_only_with_channel_access() {
    use crate::{OpensearchClient, search::channels::ChannelMessageQueryBuilder};
    use opensearch::{
        SearchParts,
        indices::{IndicesDeleteParts, IndicesRefreshParts},
    };
    use opensearch_query_builder::ToOpenSearchJson;

    let client =
        OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("imported-author-test-{}", uuid::Uuid::now_v7());
    client.ensure_index_exists(&index, json!({
        "settings": {"number_of_shards": 1, "number_of_replicas": 0,
            "analysis": {"analyzer": {"content_text": {
                "type": "custom", "tokenizer": "standard", "filter": ["icu_folding"]
            }}}},
        "mappings": {"dynamic": false, "properties": {
            "entity_id": {"type": "keyword"},
            "sender_id": {"type": "keyword"},
            "content": {"type": "text", "analyzer": "content_text"},
            "imported_author": {"type": "text", "analyzer": "content_text", "copy_to": "content"}
        }}
    })).await.unwrap();

    let result: anyhow::Result<()> = async {
        let args = args();
        client.upsert_channel_message(&args, Some(&index)).await?;
        client.inner.indices().refresh(IndicesRefreshParts::Index(&[&index]))
            .send().await?.error_for_status_code()?;
        for (channel_id, sender_ids, expected) in [
            (args.channel_id.clone(), vec![], 1),
            (uuid::Uuid::now_v7().to_string(), vec![], 0),
            (args.channel_id.clone(), vec!["quartzarchivebot".into()], 0),
            (args.channel_id.clone(), vec![args.sender_id.clone()], 1),
        ] {
            let builder = ChannelMessageQueryBuilder::new(vec!["quartzarchivebot".into()])
                .user_id("macro|viewer@example.com")
                .ids_only(true).ids(vec![channel_id]).sender_ids(sender_ids);
            let mut query = builder.build_bool_query()?.build().to_json();
            // Only redirect the production index constraint to our isolated scratch index.
            let filters = query["bool"]["filter"].as_array_mut().unwrap();
            let index_filter = filters.iter_mut().find(|filter| filter["term"]["_index"].is_string()).unwrap();
            index_filter["term"]["_index"] = json!(index);
            let response: serde_json::Value = client.inner.search(SearchParts::Index(&[&index]))
                .body(json!({"query": query, "highlight": {"fields": {"content": {"type": "plain"}}}}))
                .send().await?.error_for_status_code()?.json().await?;
            assert_eq!(response["hits"]["total"]["value"], expected);
            if expected == 1 {
                let hit = &response["hits"]["hits"][0];
                assert_eq!(hit["_source"]["content"], args.content);
                assert_eq!(hit["_source"]["message_id"], args.message_id);
                assert_eq!(hit["_source"]["thread_id"], args.thread_id);
            }
        }
        Ok(())
    }.await;
    client
        .inner
        .indices()
        .delete(IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .unwrap()
        .error_for_status_code()
        .unwrap();
    result.unwrap();
}
