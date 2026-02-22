use super::DocumentCognitionServiceClient;
use crate::error::DcsClientError;
use model::chat::ChatHistory;
use models_dcs::api::ChatHistoryBatchMessagesRequest;

impl DocumentCognitionServiceClient {
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_chat_history_external(
        &self,
        chat_id: &str,
        jwt_token: &str,
    ) -> Result<ChatHistory, DcsClientError> {
        tracing::info!(
            "dcs get chat history request (external) for chat_id: {}",
            chat_id
        );

        let res = self
            .client
            .get(format!("{}/chats/history/{}", self.url, chat_id))
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await
            .map_err(|e| DcsClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        Self::handle_response(res, "chat history retrieval").await
    }

    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_chat_history_for_messages_external(
        &self,
        message_ids: &[String],
        jwt_token: &str,
    ) -> Result<ChatHistory, DcsClientError> {
        let request = ChatHistoryBatchMessagesRequest {
            message_ids: message_ids.to_vec(),
        };

        tracing::info!(
            "dcs get chat history for messages request (external): {:?}",
            request
        );

        let res = self
            .client
            .post(format!("{}/chats/history_batch_messages", self.url))
            .header("Authorization", format!("Bearer {}", jwt_token))
            .json(&request)
            .send()
            .await
            .map_err(|e| DcsClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        Self::handle_response(res, "chat history batch messages retrieval").await
    }
}
