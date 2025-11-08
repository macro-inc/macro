use crate::{SearchServiceClient, constants::INTERNAL_MACRO_USER_ID_HEADER};
use models_search::TimestampField;

impl SearchServiceClient {
    pub async fn search_unified(
        &self,
        user_id: &str,
        body: models_search::unified::UnifiedSearchRequest,
        page: i64,
        page_size: i64,
    ) -> anyhow::Result<models_search::unified::UnifiedSearchResponse> {
        let res = self
            .client
            .post(format!(
                "{}/internal/search?page={}&page_size={}",
                self.url, page, page_size
            ))
            .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
            .json(&body)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res
                    .json::<models_search::unified::UnifiedSearchResponse>()
                    .await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(
                    "unexpected response from search service status code {}: {}",
                    status_code,
                    body
                )
            }
        }
    }

    pub async fn search_simple_unified<T: TimestampField>(
        &self,
        user_id: &str,
        body: models_search::unified::UnifiedSearchRequest,
        page: i64,
        page_size: i64,
    ) -> anyhow::Result<models_search::unified::SimpleUnifiedSearchBaseResponse<T>> {
        let res = self
            .client
            .post(format!(
                "{}/internal/search/simple?page={}&page_size={}",
                self.url, page, page_size
            ))
            .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
            .json(&body)
            .send()
            .await?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res
                    .json::<models_search::unified::SimpleUnifiedSearchBaseResponse<T>>()
                    .await?;
                Ok(result)
            }
            status_code => {
                let body: String = res.text().await?;
                anyhow::bail!(
                    "unexpected response from search service status code {}: {}",
                    status_code,
                    body
                )
            }
        }
    }
}
