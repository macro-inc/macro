use crate::{SearchServiceClient, constants::INTERNAL_MACRO_USER_ID_HEADER};

impl SearchServiceClient {
    pub async fn search_unified(
        &self,
        user_id: &str,
        body: models_search::unified::UnifiedSearchRequest,
        cursor: Option<String>,
        page_size: i64,
    ) -> anyhow::Result<models_search::unified::UnifiedSearchResponse> {
        let url = format!("{}/internal/search", self.url);

        let mut query_params: Vec<(&str, String)> = vec![("page_size", page_size.to_string())];
        if let Some(cursor) = cursor {
            query_params.push(("cursor", cursor));
        }

        let res = self
            .client
            .post(url)
            .query(&query_params)
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
}
