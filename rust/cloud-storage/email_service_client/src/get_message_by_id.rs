use crate::EmailServiceClient;
use models_email::email::service;
use models_email::email::service::message;

impl EmailServiceClient {
    // External routes - require JWT authentication and perform permission checks

    pub async fn get_message_by_id_external(
        &self,
        id: &str,
        jwt_token: &str,
    ) -> anyhow::Result<message::ParsedMessage> {
        let res = self
            .client
            .get(format!("{}/email/messages/{}", self.url, id))
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<message::ParsedMessage>().await?;
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

    pub async fn get_message_by_id_batch_external(
        &self,
        ids: &[String],
        jwt_token: &str,
    ) -> anyhow::Result<Vec<service::message::ParsedMessage>> {
        let res = self
            .client
            .post(format!("{}/email/messages/batch", self.url))
            .header("Authorization", format!("Bearer {}", jwt_token))
            .json(&ids)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<Vec<service::message::ParsedMessage>>().await?;
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

    pub async fn get_message_by_id_internal(
        &self,
        id: &str,
    ) -> anyhow::Result<message::ParsedMessage> {
        let res = self
            .client
            .get(format!("{}/internal/messages/{}", self.url, id))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<message::ParsedMessage>().await?;
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

    pub async fn get_search_message_by_id_internal(
        &self,
        id: &str,
    ) -> anyhow::Result<message::ParsedSearchMessage> {
        let res = self
            .client
            .get(format!("{}/internal/messages/{}/search", self.url, id))
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<message::ParsedSearchMessage>().await?;
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

    pub async fn get_message_by_id_batch_internal(
        &self,
        ids: &[String],
    ) -> anyhow::Result<Vec<service::message::ParsedMessage>> {
        let res = self
            .client
            .post(format!("{}/internal/messages/batch", self.url))
            .json(&ids)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<Vec<service::message::ParsedMessage>>().await?;
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
