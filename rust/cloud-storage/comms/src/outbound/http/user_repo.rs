use crate::domain::{models::UserName, ports::UserRepo};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::Url;
use rootcause::report;
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc};

#[derive(Clone)]
pub struct UserRepoImpl {
    url: Arc<Url>,
    client: reqwest::Client,
}

pub static INTERNAL_AUTH_HEADER_KEY: &str = "x-internal-auth-key";

impl UserRepoImpl {
    pub fn new(internal_auth_key: String, url: Url) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self {
            url: Arc::new(url),
            client,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct PostGetNamesRequestBody<'a> {
    pub user_ids: HashSet<MacroUserIdStr<'a>>,
}

#[derive(Deserialize, Debug)]
pub struct UserNames {
    pub names: Vec<UserName>,
}

impl UserRepo for UserRepoImpl {
    async fn get_names_for_ids(
        &self,
        user_ids: std::collections::HashSet<macro_user_id::user_id::MacroUserIdStr<'_>>,
    ) -> Result<Vec<UserName>, rootcause::Report> {
        let body = PostGetNamesRequestBody { user_ids };

        let mut url = self.url.as_ref().clone();
        url.set_path("/internal/get_names");

        let res = self.client.post(url).json(&body).send().await.inspect_err(
            |e| tracing::error!(error=?e, "failed to get names from authentication service"),
        )?;

        match res.status() {
            reqwest::StatusCode::OK => {
                let result = res.json::<UserNames>().await?;
                Ok(result.names)
            }
            status_code => {
                let body: String = res.text().await?;
                tracing::error!(
                    body=%body,
                    status=%status_code,
                    "unexpected response from authentication service"
                );
                Err(report!(body).into())
            }
        }
    }
}
