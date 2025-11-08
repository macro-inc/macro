use crate::{SearchServiceClient, constants::INTERNAL_MACRO_USER_ID_HEADER};

impl SearchServiceClient {
    pub async fn search_emails(
        &self,
        user_id: &str,
        body: models_search::email::EmailSearchRequest,
        page: i64,
        page_size: i64,
    ) -> anyhow::Result<models_search::email::EmailSearchResponse> {
        let res = self
            .client
            .post(format!(
                "{}/internal/search/email?page={}&page_size={}",
                self.url, page, page_size
            ))
            .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
            .json(&body)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res
                    .json::<models_search::email::EmailSearchResponse>()
                    .await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(format!(
                    "unexpected response from search service status code {}: {}",
                    status_code, body
                ))
            }
        }
    }
}
