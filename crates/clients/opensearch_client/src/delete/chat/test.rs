use crate::{
    OpensearchClient,
    date_format::EpochMillis,
    test_support::{LOCAL_OPENSEARCH, count, delete_index, refresh, scratch_index_like},
    upsert::chat_message::UpsertChatMessageArgs,
};

const USER: &str = "macro|chat-delete-test@example.com";
const DELETED_USER: &str = "macro|deleted-chat-user@example.com";

fn message(user_id: &str, chat_id: &str, chat_message_id: &str) -> UpsertChatMessageArgs {
    UpsertChatMessageArgs {
        chat_id: chat_id.to_owned(),
        chat_message_id: chat_message_id.to_owned(),
        user_id: user_id.to_owned(),
        role: "user".to_owned(),
        created_at_millis: EpochMillis::new(1_700_000_000_000).unwrap(),
        updated_at_millis: EpochMillis::new(1_700_000_000_000).unwrap(),
        title: "Chat".to_owned(),
        content: "zebrafish migration notes".to_owned(),
        properties: vec![],
    }
}

/// A chat's documents: the chat and every message under it.
async fn chat_documents(
    client: &opensearch::OpenSearch,
    index: &str,
    chat_id: &str,
) -> anyhow::Result<u64> {
    count(
        client,
        index,
        serde_json::json!({"bool": {"should": [
            {"term": {"entity_id": chat_id}},
            {"parent_id": {"type": "message", "id": chat_id}}
        ]}}),
    )
    .await
}

/// Three chats of two messages each, one of another user, and a message of
/// each deleted chat written just before the deletes. One chat is deleted, one
/// message of another, and every chat of the other user. Nothing of what was
/// deleted is left.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200 with the search indices created"]
async fn a_deleted_chat_message_or_user_leaves_no_documents_behind() {
    let client = OpensearchClient::new(LOCAL_OPENSEARCH.into(), "".into(), "".into()).unwrap();
    let index = scratch_index_like(&client, "chats", "chat-delete-test")
        .await
        .unwrap();
    let os = &client.inner;

    let observed: anyhow::Result<_> = async {
        for (user_id, chat_id, message_id) in [
            (USER, "chat-1", "message-1"),
            (USER, "chat-1", "message-2"),
            (USER, "chat-2", "message-3"),
            (USER, "chat-2", "message-4"),
            (DELETED_USER, "chat-3", "message-5"),
            (DELETED_USER, "chat-3", "message-6"),
        ] {
            client
                .upsert_chat_message(&message(user_id, chat_id, message_id), Some(&index))
                .await?;
        }
        refresh(os, &index).await?;
        let indexed = chat_documents(os, &index, "chat-1").await?;
        // Written after the refresh: no search sees these until the next one.
        client
            .upsert_chat_message(&message(USER, "chat-1", "message-7"), Some(&index))
            .await?;
        client
            .upsert_chat_message(&message(DELETED_USER, "chat-3", "message-8"), Some(&index))
            .await?;

        let chat_delete = client.delete_chat("chat-1", Some(&index)).await;
        let message_delete = client
            .delete_chat_message("chat-2", "message-3", Some(&index))
            .await;
        let user_delete = super::delete_user_chats(os, DELETED_USER, &index).await;
        refresh(os, &index).await?;
        Ok((
            indexed,
            chat_delete.map_err(|error| error.to_string()),
            message_delete.map_err(|error| error.to_string()),
            user_delete.map_err(|error| error.to_string()),
            chat_documents(os, &index, "chat-1").await?,
            chat_documents(os, &index, "chat-2").await?,
            chat_documents(os, &index, "chat-3").await?,
        ))
    }
    .await;

    delete_index(os, &index).await;
    assert_eq!(
        observed.unwrap(),
        (3, Ok(()), Ok(()), Ok(()), 0, 2, 0),
        "(chat-1 indexed, chat delete, message delete, user delete, chat-1, chat-2, chat-3 documents)"
    );
}
