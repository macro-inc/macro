use crate::{SearchServiceClient, constants::INTERNAL_MACRO_USER_ID_HEADER};

impl SearchServiceClient {
    pub async fn search_channel_names(
        &self,
        user_id: &str,
        body: models_search::channel::ChannelNameSearchRequest,
        cursor: Option<String>,
        page_size: i64,
    ) -> anyhow::Result<models_search::channel::ChannelNameSearchResponse> {
        let url = format!("{}/internal/search/channel/name", self.url);
        let mut query_params: Vec<(&str, String)> = vec![("page_size", page_size.to_string())];
        if let Some(cursor) = cursor {
            query_params.push(("cursor", cursor));
        }

        let response = self
            .client
            .post(url)
            .query(&query_params)
            .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
            .json(&body)
            .send()
            .await?;

        match response.status() {
            reqwest::StatusCode::OK => Ok(response.json().await?),
            status_code => {
                let body = response.text().await?;
                anyhow::bail!(
                    "unexpected response from search service status code {}: {}",
                    status_code,
                    body
                )
            }
        }
    }
}
