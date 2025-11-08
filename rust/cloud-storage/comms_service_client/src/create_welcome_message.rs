use crate::error::{ClientError, ResponseExt};
use model::comms::CreateWelcomeMessageRequest;

use super::CommsServiceClient;

impl CommsServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn create_welcome_message(
        &self,
        request: CreateWelcomeMessageRequest,
    ) -> Result<(), ClientError> {
        self.client
            .post(format!("{}/internal/create_welcome_message", self.url))
            .json(&request)
            .send()
            .await
            .map_client_error()
            .await?;

        Ok(())
    }
}
