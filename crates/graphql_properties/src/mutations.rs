use std::sync::Arc;

use async_graphql::{Context, ID, Object};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use graphql_common::parse_id;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::EntityReference;
use properties::{PropertiesAccessReceipt, PropertiesService, access_entity_type};
use uuid::Uuid;

use crate::inputs::GraphqlPropertyEntityType;

/// Mutation root for entity property writes.
#[derive(Default)]
pub struct PropertiesMutationRoot;

/// Object-safe GraphQL boundary for setting an entity property.
#[async_trait::async_trait]
pub trait EntityPropertyWriter: Send + Sync + 'static {
    /// Set or attach one property on an entity.
    async fn set_entity_property(
        &self,
        entity_type: models_properties::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<(), rootcause::Report>;
}

/// Entity property writer backed by the properties and entity access services.
pub struct PropertiesEntityPropertyWriter<P, A> {
    properties_service: Arc<P>,
    entity_access_service: Arc<A>,
    user_id: MacroUserIdStr<'static>,
}

impl<P, A> PropertiesEntityPropertyWriter<P, A> {
    /// Create a writer for the authenticated caller.
    pub fn new(
        properties_service: Arc<P>,
        entity_access_service: Arc<A>,
        user_id: MacroUserIdStr<'static>,
    ) -> Self {
        Self {
            properties_service,
            entity_access_service,
            user_id,
        }
    }
}

#[async_trait::async_trait]
impl<P, A> EntityPropertyWriter for PropertiesEntityPropertyWriter<P, A>
where
    P: PropertiesService,
    A: EntityAccessService,
{
    async fn set_entity_property(
        &self,
        entity_type: models_properties::EntityType,
        entity_id: String,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> Result<(), rootcause::Report> {
        let entity_access_receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &self.user_id,
                None,
                &entity_id,
                access_entity_type(entity_type),
            )
            .await
            .map_err(|err| rootcause::report!(err))?;
        let access = PropertiesAccessReceipt::try_from_entity_access_receipt(
            entity_access_receipt,
            entity_type,
        )
        .map_err(|err| rootcause::report!(err))?;

        self.properties_service
            .set_entity_property(&access, property_definition_id, value)
            .await
            .map_err(|err| rootcause::report!(err))?;

        Ok(())
    }
}

#[derive(async_graphql::InputObject)]
struct SetEntityPropertyInput {
    entity_type: GraphqlPropertyEntityType,
    entity_id: String,
    property_definition_id: ID,
    /// Omit or pass null to attach the property without a value.
    value: Option<GraphqlSetPropertyValue>,
}

#[derive(async_graphql::InputObject)]
struct GraphqlEntityReferenceInput {
    entity_type: GraphqlPropertyEntityType,
    entity_id: String,
    specific_message_id: Option<ID>,
}

impl GraphqlEntityReferenceInput {
    fn try_into_model(self) -> async_graphql::Result<EntityReference> {
        Ok(EntityReference {
            entity_type: self.entity_type.into(),
            entity_id: self.entity_id,
            specific_message_id: self
                .specific_message_id
                .map(|id| parse_id(id, "specificMessageId"))
                .transpose()?,
        })
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlSetPropertyValue {
    Boolean(bool),
    Date(String),
    Number(f64),
    String(String),
    SelectOption(ID),
    MultiSelectOption(Vec<ID>),
    EntityReference(GraphqlEntityReferenceInput),
    MultiEntityReference(Vec<GraphqlEntityReferenceInput>),
    Link(String),
    MultiLink(Vec<String>),
}

impl GraphqlSetPropertyValue {
    fn try_into_model(self) -> async_graphql::Result<SetPropertyValue> {
        Ok(match self {
            Self::Boolean(value) => SetPropertyValue::Boolean { value },
            Self::Date(value) => SetPropertyValue::Date {
                value: chrono::DateTime::parse_from_rfc3339(&value)
                    .map(|date| date.with_timezone(&chrono::Utc))
                    .map_err(|err| {
                        async_graphql::Error::new(format!(
                            "invalid RFC3339 property date `{value}`: {err}"
                        ))
                    })?,
            },
            Self::Number(value) => SetPropertyValue::Number { value },
            Self::String(value) => SetPropertyValue::String { value },
            Self::SelectOption(option_id) => SetPropertyValue::SelectOption {
                option_id: parse_id(option_id, "selectOption")?,
            },
            Self::MultiSelectOption(option_ids) => SetPropertyValue::MultiSelectOption {
                option_ids: option_ids
                    .into_iter()
                    .map(|id| parse_id(id, "multiSelectOption"))
                    .collect::<async_graphql::Result<_>>()?,
            },
            Self::EntityReference(reference) => SetPropertyValue::EntityReference {
                reference: reference.try_into_model()?,
            },
            Self::MultiEntityReference(references) => SetPropertyValue::MultiEntityReference {
                references: references
                    .into_iter()
                    .map(GraphqlEntityReferenceInput::try_into_model)
                    .collect::<async_graphql::Result<_>>()?,
            },
            Self::Link(url) => SetPropertyValue::Link { url },
            Self::MultiLink(urls) => SetPropertyValue::MultiLink { urls },
        })
    }
}

#[Object]
impl PropertiesMutationRoot {
    /// Set or attach one property on an entity.
    async fn set_entity_property(
        &self,
        ctx: &Context<'_>,
        input: SetEntityPropertyInput,
    ) -> async_graphql::Result<bool> {
        let writer = ctx.data::<Arc<dyn EntityPropertyWriter>>()?;
        let property_definition_id =
            parse_id(input.property_definition_id, "propertyDefinitionId")?;
        let value = input
            .value
            .map(GraphqlSetPropertyValue::try_into_model)
            .transpose()?;

        writer
            .set_entity_property(
                input.entity_type.into(),
                input.entity_id,
                property_definition_id,
                value,
            )
            .await
            .map_err(|err| async_graphql::Error::new(err.to_string()))?;

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_graphql::{EmptySubscription, Object, Schema};

    use super::*;

    #[derive(Default)]
    struct QueryRoot;

    #[Object]
    impl QueryRoot {
        async fn health(&self) -> bool {
            true
        }
    }

    type CapturedWrite = (
        models_properties::EntityType,
        String,
        Uuid,
        Option<SetPropertyValue>,
    );

    #[derive(Default)]
    struct CapturingWriter {
        write: Mutex<Option<CapturedWrite>>,
    }

    #[async_trait::async_trait]
    impl EntityPropertyWriter for CapturingWriter {
        async fn set_entity_property(
            &self,
            entity_type: models_properties::EntityType,
            entity_id: String,
            property_definition_id: Uuid,
            value: Option<SetPropertyValue>,
        ) -> Result<(), rootcause::Report> {
            *self.write.lock().expect("capture mutex poisoned") =
                Some((entity_type, entity_id, property_definition_id, value));
            Ok(())
        }
    }

    #[tokio::test]
    async fn set_entity_property_forwards_to_writer() {
        let writer = Arc::new(CapturingWriter::default());
        let writer_data: Arc<dyn EntityPropertyWriter> = writer.clone();
        let schema = Schema::build(QueryRoot, PropertiesMutationRoot, EmptySubscription)
            .data(writer_data)
            .finish();
        let property_definition_id = Uuid::from_u128(1);
        let option_id = Uuid::from_u128(2);

        let response = schema
            .execute(format!(
                r#"
                mutation {{
                    setEntityProperty(input: {{
                        entityType: TASK,
                        entityId: "task-1",
                        propertyDefinitionId: "{property_definition_id}",
                        value: {{ selectOption: "{option_id}" }}
                    }})
                }}
                "#
            ))
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data,
            async_graphql::value!({ "setEntityProperty": true })
        );
        assert_eq!(
            writer.write.lock().expect("capture mutex poisoned").clone(),
            Some((
                models_properties::EntityType::Task,
                "task-1".to_string(),
                property_definition_id,
                Some(SetPropertyValue::SelectOption { option_id }),
            ))
        );
    }
}
