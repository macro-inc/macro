use constants::INTERNAL_AUTH_HEADER_KEY;
use macro_service_client::AssertHealth;

pub(crate) mod constants;
pub mod delete_entity;
pub mod get_bulk_entity_properties;

pub use models_properties::{
    DataType, EntityReference, EntityType,
    api::{BulkEntityPropertiesResponse, EntityPropertiesResponse},
    service::{
        entity_property_with_definition::EntityPropertyWithDefinition,
        property_definition::PropertyDefinition,
        property_definition_with_options::PropertyDefinitionWithOptions,
    },
};

#[derive(Clone)]
pub struct PropertiesServiceClient {
    url: String,
    client: reqwest::Client,
}

impl PropertiesServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }
}

impl AssertHealth for PropertiesServiceClient {
    #[tracing::instrument(skip(self), err)]
    async fn assert_health(&self) -> Result<(), anyhow::Error> {
        self.client
            .get(format!("{}/internal/health", self.url))
            .send()
            .await
            .map_err(Into::into)
            .map(|_| ())
    }
}
