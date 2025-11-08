use crate::api::search::simple::SearchError;
use crate::{api::ApiContext, util};
use crate::{api::search::simple::simple_chat::search_chats, model::ChatOpenSearchResponse};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_db_client::chat::get::ChatHistoryInfo;
use model::{response::ErrorResponse, user::UserContext};
use models_search::chat::{
    ChatMessageSearchResult, ChatSearchMetadata, ChatSearchRequest, ChatSearchResponse,
    ChatSearchResponseItem, ChatSearchResponseItemWithMetadata,
};
use std::collections::HashMap;

use super::SearchPaginationParams;

/// Performs a search through chats and enriches the results with metadata
pub async fn search_chats_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: ChatSearchRequest,
) -> Result<Vec<ChatSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_chats(ctx, user_id, query_params, req).await?;

    // Extract chat IDs from results
    let chat_ids: Vec<String> = opensearch_results
        .iter()
        .map(|r| r.chat_id.clone())
        .collect();

    // Fetch chat metadata from database
    let chat_histories =
        macro_db_client::chat::get::get_chat_history_info(&ctx.db, user_id, &chat_ids)
            .await
            .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results = construct_search_result(opensearch_results, chat_histories)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Perform a search through your chats
#[utoipa::path(
        post,
        path = "/search/chat",
        operation_id = "chat_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=ChatSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<ChatSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("chat_search");
    let user_id = user_context.user_id.as_str();

    let results = search_chats_enriched(&ctx, user_id, &query_params, req).await?;

    let result = ChatSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::chats::ChatSearchResponse>,
    chat_histories: HashMap<String, ChatHistoryInfo>,
) -> anyhow::Result<Vec<ChatSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| ChatOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        ChatOpenSearchResponse,
        ChatMessageSearchResult,
        ChatSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<ChatSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    // Add metadata for each chat fetched from macrodb
    let result: Vec<ChatSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let chat_history_info = chat_histories
                .get(&item.chat_id)
                .cloned()
                .unwrap_or_default();
            ChatSearchResponseItemWithMetadata {
                created_at: chat_history_info.created_at.timestamp(),
                updated_at: chat_history_info.updated_at.timestamp(),
                viewed_at: chat_history_info.viewed_at.map(|a| a.timestamp()),
                project_id: chat_history_info.project_id,
                extra: item,
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::types::chrono;

    fn create_test_response(
        chat_id: &str,
        chat_message_id: &str,
        user_id: &str,
        content: Option<Vec<String>>,
    ) -> opensearch_client::search::chats::ChatSearchResponse {
        opensearch_client::search::chats::ChatSearchResponse {
            chat_id: chat_id.to_string(),
            chat_message_id: chat_message_id.to_string(),
            user_id: user_id.to_string(),
            role: "user".to_string(),
            updated_at: 1234567890,
            title: "Test Chat".to_string(),
            content,
        }
    }

    #[test]
    fn test_empty_input() {
        let input = vec![];
        let result = construct_search_result(input, HashMap::new()).unwrap();
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_single_chat_with_content() {
        let input = vec![create_test_response(
            "chat_1",
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.chat_id, "chat_1");
        assert_eq!(result[0].extra.id, "chat_1");
        assert_eq!(result[0].extra.user_id, "user_1");
        assert_eq!(result[0].extra.owner_id, "user_1");
        assert_eq!(result[0].extra.name, "Test Chat");
        assert_eq!(result[0].extra.chat_search_results.len(), 1);
        assert_eq!(
            result[0].extra.chat_search_results[0].chat_message_id,
            "msg_1"
        );
        assert_eq!(
            result[0].extra.chat_search_results[0].content,
            vec!["hello world"]
        );
    }

    #[test]
    fn test_single_chat_without_content() {
        let input = vec![create_test_response("chat_1", "msg_1", "user_1", None)];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.chat_id, "chat_1");
        assert_eq!(result[0].extra.id, "chat_1");
        assert_eq!(result[0].extra.user_id, "user_1");
        assert_eq!(result[0].extra.owner_id, "user_1");
        assert_eq!(result[0].extra.name, "Test Chat");
        assert_eq!(result[0].extra.chat_search_results.len(), 0); // Filtered out by From trait
    }

    #[test]
    fn test_single_chat_multiple_messages() {
        let input = vec![
            create_test_response("chat_1", "msg_1", "user_1", Some(vec!["hello".to_string()])),
            create_test_response("chat_1", "msg_2", "user_1", Some(vec!["world".to_string()])),
        ];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.chat_id, "chat_1");
        assert_eq!(result[0].extra.id, "chat_1");
        assert_eq!(result[0].extra.chat_search_results.len(), 2);

        // Check both messages are present
        let message_ids: Vec<&String> = result[0]
            .extra
            .chat_search_results
            .iter()
            .map(|r| &r.chat_message_id)
            .collect();
        assert!(message_ids.contains(&&"msg_1".to_string()));
        assert!(message_ids.contains(&&"msg_2".to_string()));
    }

    #[test]
    fn test_multiple_chats() {
        let input = vec![
            create_test_response("chat_1", "msg_1", "user_1", Some(vec!["hello".to_string()])),
            create_test_response("chat_2", "msg_2", "user_2", Some(vec!["world".to_string()])),
        ];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 2);

        // Check both chats are present
        let chat_ids: Vec<&String> = result.iter().map(|r| &r.extra.id).collect();
        assert!(chat_ids.contains(&&"chat_1".to_string()));
        assert!(chat_ids.contains(&&"chat_2".to_string()));

        // Each chat should have one message
        for chat in &result {
            assert_eq!(chat.extra.chat_search_results.len(), 1);
        }
    }

    #[test]
    fn test_mixed_content_presence() {
        let input = vec![
            create_test_response(
                "chat_1",
                "msg_1",
                "user_1",
                Some(vec!["visible".to_string()]),
            ),
            create_test_response("chat_1", "msg_2", "user_1", None), // No content
            create_test_response(
                "chat_1",
                "msg_3",
                "user_1",
                Some(vec!["also visible".to_string()]),
            ),
        ];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.chat_id, "chat_1");
        assert_eq!(result[0].extra.id, "chat_1");
        assert_eq!(result[0].extra.chat_search_results.len(), 2); // Only messages with content

        let contents: Vec<&Vec<String>> = result[0]
            .extra
            .chat_search_results
            .iter()
            .map(|r| &r.content)
            .collect();
        assert!(contents.contains(&&vec!["visible".to_string()]));
        assert!(contents.contains(&&vec!["also visible".to_string()]));
    }

    #[test]
    fn test_user_id_taken_from_first_result() {
        let input = vec![
            create_test_response(
                "chat_1",
                "msg_1",
                "user_first",
                Some(vec!["content1".to_string()]),
            ),
            create_test_response(
                "chat_1",
                "msg_2",
                "user_second",
                Some(vec!["content2".to_string()]),
            ),
        ];
        let result = construct_search_result(input, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        // user_id should come from the first result (base_search_result)
        assert_eq!(result[0].extra.user_id, "user_first");
        assert_eq!(result[0].extra.chat_search_results.len(), 2);
    }

    #[test]
    fn test_chat_history_timestamps() {
        // Create a test response
        let input = vec![create_test_response(
            "chat_1",
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock chat history with known timestamps
        let mut chat_histories = HashMap::new();
        let now = chrono::Utc::now();

        let history = ChatHistoryInfo {
            item_id: "chat_1".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            project_id: Some("project_1".to_string()),
        };

        chat_histories.insert("chat_1".to_string(), history);

        // Call the function under test
        let result = construct_search_result(input, chat_histories).unwrap();

        // Verify that timestamps were copied from the chat history
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].created_at, now.timestamp());
        assert_eq!(result[0].updated_at, now.timestamp());
        assert_eq!(result[0].viewed_at, Some(now.timestamp()));
    }

    #[test]
    fn test_chat_history_missing_entry() {
        // Create a test response for a chat that doesn't have history
        let input = vec![create_test_response(
            "chat_missing",
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock chat history that doesn't contain the chat_id
        let mut chat_histories = HashMap::new();
        let now = chrono::Utc::now();

        let history = ChatHistoryInfo {
            item_id: "different_chat".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None,
            project_id: Some("project_1".to_string()),
        };

        chat_histories.insert("different_chat".to_string(), history);

        // Call the function under test
        let result = construct_search_result(input, chat_histories).unwrap();

        // Verify that default timestamps were used
        assert_eq!(result.len(), 1);

        // Default values from ChatHistoryInfo::default()
        let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
        assert_eq!(result[0].created_at, default_time);
        assert_eq!(result[0].updated_at, default_time);
        assert_eq!(result[0].viewed_at, None);
    }

    #[test]
    fn test_chat_history_null_viewed_at() {
        // Create a test response
        let input = vec![create_test_response(
            "chat_1",
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock chat history with null viewed_at
        let mut chat_histories = HashMap::new();
        let now = chrono::Utc::now();

        let history = ChatHistoryInfo {
            item_id: "chat_1".to_string(),
            created_at: now,
            updated_at: now,
            viewed_at: None, // This user has never viewed this chat
            project_id: Some("project_1".to_string()),
        };

        chat_histories.insert("chat_1".to_string(), history);

        // Call the function under test
        let result = construct_search_result(input, chat_histories).unwrap();

        // Verify that timestamps were copied correctly and viewed_at is None
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].created_at, now.timestamp());
        assert_eq!(result[0].updated_at, now.timestamp());
        assert_eq!(result[0].viewed_at, None);
    }
}
