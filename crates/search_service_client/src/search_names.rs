use std::time::Duration;

use models_search::names::{NameSearchRequest, NameSearchResponse};

use crate::{SearchServiceClient, constants::INTERNAL_MACRO_USER_ID_HEADER};

/// How long a name lookup may take before it is given up on.
const SEARCH_NAMES_TIMEOUT: Duration = Duration::from_secs(5);

/// Why a name lookup failed.
#[derive(Debug, thiserror::Error)]
pub enum SearchNamesError {
    /// The search service refused the request, such as for too many names.
    #[error("the search service refused the names: {0}")]
    Refused(String),
    /// The search service could not be reached or did not answer in time.
    #[error("the search service could not be reached")]
    Unreachable(#[source] reqwest::Error),
    /// The search service answered OK with a body that isn't matches.
    #[error("the search service's matches couldn't be read")]
    Undecodable(#[source] reqwest::Error),
    /// The search service answered with something other than matches.
    #[error("unexpected response from the search service, status {status}: {body}")]
    Unexpected {
        /// The response's status code.
        status: u16,
        /// The response's body.
        body: String,
    },
}

impl SearchServiceClient {
    /// Look up names as `user_id`: per name, in the order given, the items of
    /// the kinds asked for that the user can access, exact matches first.
    #[tracing::instrument(skip(self, body), fields(names = body.names.len()), err)]
    pub async fn search_names(
        &self,
        user_id: &str,
        body: &NameSearchRequest,
    ) -> Result<NameSearchResponse, SearchNamesError> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(format!("{}/internal/search/names", self.url))
            .headers(headers)
            .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
            .timeout(SEARCH_NAMES_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(SearchNamesError::Unreachable)?;
        let status = response.status();
        if status == reqwest::StatusCode::OK {
            return response.json().await.map_err(SearchNamesError::Undecodable);
        }
        let body = response
            .text()
            .await
            .map_err(SearchNamesError::Unreachable)?;
        if status == reqwest::StatusCode::BAD_REQUEST {
            return Err(SearchNamesError::Refused(body));
        }
        Err(SearchNamesError::Unexpected {
            status: status.as_u16(),
            body,
        })
    }
}
