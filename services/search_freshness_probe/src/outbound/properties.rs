//! The property probe's writes: a user-scoped text property named with the
//! marker, and a document of the probe's own that holds its value.

use models_properties::DataType;
use models_properties::api::requests::{
    CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType, SetPropertyValue,
};
use models_properties::service::property_definition::PropertyDefinition;
use reqwest::Method;
use serde::Serialize;

use super::entities::{create_markdown, purge_document, purge_unshared};
use super::macro_api::{ApiError, Call, MacroApi, NO_BODY};
use crate::domain::model::{EntityId, MARKER, Token};
use crate::domain::ports::PropertyWrites;

#[cfg(test)]
mod test;

/// Mirrors `properties::inbound::axum_router::entities::SetEntityPropertyRequest`,
/// which lives beside its handler.
#[derive(Serialize)]
struct SetEntityProperty {
    value: SetPropertyValue,
}

/// Properties through `api`.
pub struct Properties {
    api: MacroApi,
    /// Documents it could neither make private nor delete.
    unshared: Vec<EntityId>,
}

impl Properties {
    /// Properties written through `api`.
    pub fn new(api: MacroApi) -> Self {
        Self {
            api,
            unshared: Vec::new(),
        }
    }
}

impl PropertyWrites for Properties {
    type Err = ApiError;

    async fn definition(&mut self) -> Result<EntityId, ApiError> {
        let definitions: Vec<PropertyDefinition> = self
            .api
            .json(
                Call::new(
                    Method::GET,
                    "/dss/properties/definitions",
                    "/dss/properties/definitions?scope=user".to_owned(),
                ),
                NO_BODY,
            )
            .await?;
        let existing = definitions.into_iter().find(|definition| {
            definition.display_name == MARKER && definition.data_type == DataType::String
        });
        if let Some(definition) = existing {
            return Ok(EntityId(definition.id));
        }

        let created: PropertyDefinition = self
            .api
            .json(
                Call::new(
                    Method::POST,
                    "/dss/properties/definitions",
                    "/dss/properties/definitions".to_owned(),
                ),
                Some(&CreatePropertyDefinitionRequest {
                    scope: CreatePropertyScope::User,
                    display_name: MARKER.to_owned(),
                    data_type: PropertyDataType::String,
                }),
            )
            .await?;
        Ok(EntityId(created.id))
    }

    async fn create_document(&mut self, name: &Token) -> Result<EntityId, ApiError> {
        purge_unshared(&self.api, &mut self.unshared).await;
        create_markdown(&self.api, name, None, &mut self.unshared).await
    }

    async fn set(
        &mut self,
        document: EntityId,
        definition: EntityId,
        value: &Token,
    ) -> Result<(), ApiError> {
        self.api
            .send_done(
                Call::new(
                    Method::PUT,
                    "/dss/properties/entities/DOCUMENT/{document_id}/{definition_id}",
                    format!("/dss/properties/entities/DOCUMENT/{document}/{definition}"),
                ),
                Some(&SetEntityProperty {
                    value: SetPropertyValue::String {
                        value: value.as_str().to_owned(),
                    },
                }),
                &[],
            )
            .await
    }

    async fn delete_document(&mut self, document: EntityId) -> Result<(), ApiError> {
        purge_document(&self.api, document).await
    }

    async fn close(&mut self) {
        purge_unshared(&self.api, &mut self.unshared).await;
    }
}
