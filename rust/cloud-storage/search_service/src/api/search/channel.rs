use crate::{
    api::search::simple::{SearchError, simple_channel::search_channels},
    model::ChannelOpenSearchResponse,
};
use std::collections::HashMap;

use super::SearchPaginationParams;
use crate::{api::ApiContext, util};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::comms::{ChannelHistoryInfo, GetChannelsHistoryRequest};
use model::{response::ErrorResponse, user::UserContext};
use models_search::channel::{
    ChannelSearchMetadata, ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem,
    ChannelSearchResponseItemWithMetadata, ChannelSearchResult,
};
use sqlx::types::Uuid;

/// Performs a search through channels and enriches the results with metadata
pub async fn search_channels_enriched(
    ctx: &ApiContext,
    user_id: &str,
    user_organization_id: Option<i32>,
    query_params: &SearchPaginationParams,
    req: ChannelSearchRequest,
) -> Result<Vec<ChannelSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results =
        search_channels(ctx, user_id, user_organization_id, query_params, req).await?;

    // Extract channel IDs from results
    let channel_ids: Vec<Uuid> = opensearch_results
        .iter()
        .filter_map(|r| {
            match Uuid::parse_str(&r.channel_id) {
                Ok(uuid) => Some(uuid),
                Err(e) => {
                    tracing::warn!(error=?e, channel_id=?r.channel_id, "Failed to parse channel ID as UUID");
                    None
                }
            }
        })
        .collect();

    // Fetch channel metadata from comms service
    let channel_histories = ctx
        .comms_service_client
        .get_channels_history(GetChannelsHistoryRequest {
            user_id: user_id.to_string(),
            channel_ids,
        })
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(opensearch_results, channel_histories.channels_history)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Perform a search through your emails
#[utoipa::path(
        post,
        path = "/search/channel",
        operation_id = "channel_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=ChannelSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<ChannelSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("channel_search");

    let results = search_channels_enriched(
        &ctx,
        user_context.user_id.as_str(),
        user_context.organization_id,
        &query_params,
        req,
    )
    .await?;

    let result = ChannelSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::channels::ChannelMessageSearchResponse>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| ChannelOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        ChannelOpenSearchResponse,
        ChannelSearchResult,
        ChannelSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<ChannelSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    let result: Vec<ChannelSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let channel_uuid = Uuid::parse_str(&item.channel_id).unwrap_or_else(|_| Uuid::nil());
            let channel_history_info = channel_histories
                .get(&channel_uuid)
                .cloned()
                .unwrap_or_default();
            ChannelSearchResponseItemWithMetadata {
                created_at: channel_history_info.created_at.timestamp(),
                updated_at: channel_history_info.updated_at.timestamp(),
                viewed_at: channel_history_info.viewed_at.map(|a| a.timestamp()),
                interacted_at: channel_history_info.interacted_at.map(|a| a.timestamp()),
                extra: item,
            }
        })
        .collect();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_construct_search_result_empty_input() {
        let result = construct_search_result(vec![], HashMap::new());
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn test_construct_search_result_single_channel() {
        let search_results = vec![
            opensearch_client::search::channels::ChannelMessageSearchResponse {
                channel_id: "channel1".to_string(),
                channel_name: Some("Test Channel".to_string()),
                channel_type: "public".to_string(),
                org_id: Some(123),
                message_id: "msg1".to_string(),
                thread_id: Some("thread1".to_string()),
                sender_id: "user1".to_string(),
                mentions: vec!["@user2".to_string()],
                created_at: 1234567890,
                updated_at: 1234567891,
                content: Some(vec!["Test message content".to_string()]),
            },
        ];

        let result = construct_search_result(search_results, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.channel_id, "channel1");
        assert_eq!(result[0].extra.id, "channel1");
        assert_eq!(
            result[0].extra.channel_name,
            Some("Test Channel".to_string())
        );
        assert_eq!(result[0].extra.name, Some("Test Channel".to_string()));
        assert_eq!(result[0].extra.channel_message_search_results.len(), 1);
        assert_eq!(
            result[0].extra.channel_message_search_results[0].message_id,
            "msg1"
        );
        assert_eq!(
            result[0].extra.channel_message_search_results[0].sender_id,
            "user1"
        );
        assert_eq!(
            result[0].extra.channel_message_search_results[0].thread_id,
            Some("thread1".to_string())
        );
    }

    #[test]
    fn test_construct_search_result_multiple_messages_same_channel() {
        let search_results = vec![
            opensearch_client::search::channels::ChannelMessageSearchResponse {
                channel_id: "channel1".to_string(),
                channel_name: Some("Test Channel".to_string()),
                channel_type: "public".to_string(),
                org_id: Some(123),
                message_id: "msg1".to_string(),
                thread_id: Some("thread1".to_string()),
                sender_id: "user1".to_string(),
                mentions: vec![],
                created_at: 1234567890,
                updated_at: 1234567891,
                content: Some(vec!["First message".to_string()]),
            },
            opensearch_client::search::channels::ChannelMessageSearchResponse {
                channel_id: "channel1".to_string(),
                channel_name: Some("Test Channel".to_string()),
                channel_type: "public".to_string(),
                org_id: Some(123),
                message_id: "msg2".to_string(),
                thread_id: Some("thread2".to_string()),
                sender_id: "user2".to_string(),
                mentions: vec!["@user1".to_string()],
                created_at: 1234567892,
                updated_at: 1234567893,
                content: Some(vec!["Second message".to_string()]),
            },
        ];

        let result = construct_search_result(search_results, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.channel_id, "channel1");
        assert_eq!(result[0].extra.id, "channel1");
        assert_eq!(result[0].extra.name, Some("Test Channel".to_string()));
        assert_eq!(result[0].extra.channel_message_search_results.len(), 2);

        let message_ids: Vec<String> = result[0]
            .extra
            .channel_message_search_results
            .iter()
            .map(|r| r.message_id.clone())
            .collect();
        assert!(message_ids.contains(&"msg1".to_string()));
        assert!(message_ids.contains(&"msg2".to_string()));

        let sender_ids: Vec<String> = result[0]
            .extra
            .channel_message_search_results
            .iter()
            .map(|r| r.sender_id.clone())
            .collect();
        assert!(sender_ids.contains(&"user1".to_string()));
        assert!(sender_ids.contains(&"user2".to_string()));
    }

    #[test]
    fn test_construct_search_result_filters_messages_without_content() {
        let search_results = vec![
            opensearch_client::search::channels::ChannelMessageSearchResponse {
                channel_id: "channel1".to_string(),
                channel_name: Some("Test Channel".to_string()),
                channel_type: "public".to_string(),
                org_id: Some(123),
                message_id: "msg1".to_string(),
                thread_id: Some("thread1".to_string()),
                sender_id: "user1".to_string(),
                mentions: vec![],
                created_at: 1234567890,
                updated_at: 1234567891,
                content: Some(vec!["Message with content".to_string()]),
            },
            opensearch_client::search::channels::ChannelMessageSearchResponse {
                channel_id: "channel1".to_string(),
                channel_name: Some("Test Channel".to_string()),
                channel_type: "public".to_string(),
                org_id: Some(123),
                message_id: "msg2".to_string(),
                thread_id: Some("thread2".to_string()),
                sender_id: "user2".to_string(),
                mentions: vec![],
                created_at: 1234567892,
                updated_at: 1234567893,
                content: None,
            },
        ];

        let result = construct_search_result(search_results, HashMap::new()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].extra.channel_message_search_results.len(), 1);
        assert_eq!(
            result[0].extra.channel_message_search_results[0].message_id,
            "msg1"
        );
    }

    fn create_test_channel_response(
        channel_id: &str,
        message_id: &str,
        sender_id: &str,
        content: Option<Vec<String>>,
    ) -> opensearch_client::search::channels::ChannelMessageSearchResponse {
        opensearch_client::search::channels::ChannelMessageSearchResponse {
            channel_id: channel_id.to_string(),
            channel_name: Some("Test Channel".to_string()),
            channel_type: "public".to_string(),
            org_id: Some(123),
            message_id: message_id.to_string(),
            thread_id: Some("thread1".to_string()),
            sender_id: sender_id.to_string(),
            mentions: vec![],
            created_at: 1234567890,
            updated_at: 1234567891,
            content,
        }
    }

    #[test]
    fn test_channel_history_timestamps() {
        // Create a mock channel history with known timestamps
        let mut channel_histories = HashMap::new();
        let now = chrono::Utc::now();
        let channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440001").unwrap();

        let history = ChannelHistoryInfo {
            item_id: channel_uuid,
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            interacted_at: Some(now),
        };

        channel_histories.insert(channel_uuid, history);

        // Create a test response with the UUID
        let input = vec![create_test_channel_response(
            &channel_uuid.to_string(),
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Call the function under test
        let result = construct_search_result(input, channel_histories).unwrap();

        // Verify that timestamps were copied from the channel history
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].created_at, now.timestamp());
        assert_eq!(result[0].updated_at, now.timestamp());
        assert_eq!(result[0].viewed_at, Some(now.timestamp()));
        assert_eq!(result[0].interacted_at, Some(now.timestamp()));
    }

    #[test]
    fn test_channel_history_missing_entry() {
        // Create a test response for a channel that doesn't have history
        let missing_channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440002").unwrap();
        let input = vec![create_test_channel_response(
            &missing_channel_uuid.to_string(),
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock channel history that doesn't contain the channel_id
        let mut channel_histories = HashMap::new();
        let now = chrono::Utc::now();
        let different_channel_uuid =
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440003").unwrap();

        let history = ChannelHistoryInfo {
            item_id: different_channel_uuid,
            created_at: now,
            updated_at: now,
            viewed_at: None,
            interacted_at: None,
        };

        channel_histories.insert(different_channel_uuid, history);

        // Call the function under test
        let result = construct_search_result(input, channel_histories).unwrap();

        // Verify that default timestamps were used
        assert_eq!(result.len(), 1);

        // Default values from ChannelHistoryInfo::default()
        let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
        assert_eq!(result[0].created_at, default_time);
        assert_eq!(result[0].updated_at, default_time);
        assert_eq!(result[0].viewed_at, None);
        assert_eq!(result[0].interacted_at, None);
    }

    #[test]
    fn test_channel_history_null_viewed_at() {
        // Create a test response
        let channel_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440004").unwrap();
        let input = vec![create_test_channel_response(
            &channel_uuid.to_string(),
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock channel history with null viewed_at
        let mut channel_histories = HashMap::new();
        let now = chrono::Utc::now();

        let history = ChannelHistoryInfo {
            item_id: channel_uuid,
            created_at: now,
            updated_at: now,
            viewed_at: None,     // This user has never viewed this channel
            interacted_at: None, // This user has never interacted with this channel
        };

        channel_histories.insert(channel_uuid, history);

        // Call the function under test
        let result = construct_search_result(input, channel_histories).unwrap();

        // Verify that timestamps were copied correctly and viewed_at is None
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].created_at, now.timestamp());
        assert_eq!(result[0].updated_at, now.timestamp());
        assert_eq!(result[0].viewed_at, None);
        assert_eq!(result[0].interacted_at, None);
    }

    #[test]
    fn test_channel_history_invalid_uuid() {
        // Create a test response with an invalid UUID
        let input = vec![create_test_channel_response(
            "invalid-uuid",
            "msg_1",
            "user_1",
            Some(vec!["hello world".to_string()]),
        )];

        // Create a mock channel history
        let channel_histories = HashMap::new();

        // Call the function under test
        let result = construct_search_result(input, channel_histories).unwrap();

        // Verify that default timestamps were used since UUID parsing failed
        assert_eq!(result.len(), 1);
        let default_time = chrono::DateTime::<chrono::Utc>::default().timestamp();
        assert_eq!(result[0].created_at, default_time);
        assert_eq!(result[0].updated_at, default_time);
        assert_eq!(result[0].viewed_at, None);
        assert_eq!(result[0].interacted_at, None);
    }
}
