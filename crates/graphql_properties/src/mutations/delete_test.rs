//! Assignment deletion preserves the normalized cache identity and domain errors.

use async_graphql::{EmptySubscription, Schema};

use super::*;

/// Minimal query root needed by the mutation schema.
struct Query;

#[Object]
impl Query {
    /// Whether the fixture schema is available.
    async fn ready(&self) -> bool {
        true
    }
}

/// Writer accepting only the exact authorized fixture assignment.
struct DeleteWriter;

impl EntityPropertyWriter for DeleteWriter {
    async fn delete_entity_property(
        &self,
        entity_type: model_entity::EntityType,
        entity_id: String,
        entity_property_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        assert_eq!(entity_type, model_entity::EntityType::Initiative);
        assert_eq!(entity_id, "initiative-1");
        if entity_property_id != Uuid::from_u128(1) {
            return Err(rootcause::report!("required property cannot be deleted"));
        }
        Ok(())
    }

    async fn set_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _property_definition_id: Uuid,
        _value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        Err(rootcause::report!("unexpected assignment write"))
    }

    async fn update_entity_property_options(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        Err(rootcause::report!("unexpected option write"))
    }
}

#[tokio::test]
async fn deletion_marks_the_assignment_record_and_preserves_rejections() {
    let schema = Schema::build(
        Query,
        PropertiesMutationRoot::<DeleteWriter>::new(),
        EmptySubscription,
    )
    .data(DeleteWriter)
    .finish();
    let mutation = |id: Uuid| {
        format!(
            "mutation {{ deleteEntityProperty(entityType: INITIATIVE, entityId: \"initiative-1\", entityPropertyId: \"{id}\") {{ graphqlTypeName entityId }} }}"
        )
    };
    let response = schema.execute(mutation(Uuid::from_u128(1))).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({
            "deleteEntityProperty": {
                "graphqlTypeName": "GraphqlProperty",
                "entityId": Uuid::from_u128(1).to_string(),
            }
        })
    );
    let rejected = schema.execute(mutation(Uuid::from_u128(2))).await;
    assert_eq!(rejected.errors.len(), 1);
    assert!(rejected.errors[0].message.contains("required property"));
    assert!(matches!(rejected.data, async_graphql::Value::Null));

    let malformed = schema.execute("mutation { deleteEntityProperty(entityType: INITIATIVE, entityId: \"initiative-1\", entityPropertyId: \"not-a-uuid\") { graphqlTypeName entityId } }").await;
    assert_eq!(malformed.errors.len(), 1);
    assert!(malformed.errors[0].message.contains("entityPropertyId"));
    assert!(matches!(malformed.data, async_graphql::Value::Null));
}
