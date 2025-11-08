use std::collections::HashSet;

use constants::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY;
use macro_client_errors::MacroClientError;

pub(crate) mod constants;
pub(crate) mod get_users;

#[derive(Clone)]
pub struct OrganizationServiceClient {
    url: String,
    client: reqwest::Client,
}

impl OrganizationServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            internal_auth_key.parse().unwrap(),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }

    pub async fn get_all_users_in_organization(
        &self,
        organization_id: i32,
    ) -> Result<Vec<String>, MacroClientError> {
        let mut users: HashSet<String> = HashSet::new();

        let limit = 100;
        let mut offset = 0;

        loop {
            let result = self
                .get_organization_users(organization_id, limit, offset)
                .await?;

            users.extend(result.users);

            if result.next_offset.is_none() {
                break;
            }

            offset = result.next_offset.unwrap();
        }

        Ok(users.into_iter().collect())
    }
}
