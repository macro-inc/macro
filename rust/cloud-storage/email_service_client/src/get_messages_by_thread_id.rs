use crate::EmailServiceClient;
use models_email::email::service::message;

impl EmailServiceClient {
    // External routes - require JWT authentication and perform permission checks

    // message_limit has max value of 100
    pub async fn get_messages_by_thread_id_external(
        &self,
        id: &str,
        message_offset: i64,
        message_limit: i64,
        jwt_token: &str,
    ) -> anyhow::Result<Vec<message::ParsedMessage>> {
        let res = self
            .client
            .get(format!(
                "{}/email/threads/{}/messages?message_offset={}&message_limit={}",
                self.url, id, message_offset, message_limit
            ))
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<Vec<message::ParsedMessage>>().await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(format!(
                    "unexpected response from email service status code {}: {}",
                    status_code, body
                ))
            }
        }
    }

    // Internal routes - no authentication, used for service-to-service communication

    // message_limit has max value of 100
    pub async fn get_messages_by_thread_id_internal(
        &self,
        id: &str,
        message_offset: i64,
        message_limit: i64,
    ) -> anyhow::Result<Vec<message::ParsedMessage>> {
        let res = self
            .client
            .get(format!(
                "{}/internal/threads/{}/messages?message_offset={}&message_limit={}",
                self.url, id, message_offset, message_limit
            ))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<Vec<message::ParsedMessage>>().await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(format!(
                    "unexpected response from email service status code {}: {}",
                    status_code, body
                ))
            }
        }
    }

    pub async fn get_search_messages_by_thread_id_internal(
        &self,
        id: &str,
        message_offset: i64,
        message_limit: i64,
    ) -> anyhow::Result<Vec<message::ParsedSearchMessage>> {
        let res = self
            .client
            .get(format!(
                "{}/internal/threads/{}/messages/search?message_offset={}&message_limit={}",
                self.url, id, message_offset, message_limit
            ))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<Vec<message::ParsedSearchMessage>>().await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(format!(
                    "unexpected response from email service status code {}: {}",
                    status_code, body
                ))
            }
        }
    }
}
