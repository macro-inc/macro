//! Contract coverage for property definition identity, authorization context, and lazy options.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use uuid::Uuid;

use super::*;
use crate::{NoOpEntityPropertyReader, entity_properties_loader};

/// Request reader recording option work for lazy-field assertions.
struct TestReader(Arc<AtomicUsize>);

impl EntityPropertyReader for TestReader {
    async fn get_definitions(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: GraphqlPropertyDefinitionScope,
        for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<Vec<PropertyDefinition>, rootcause::Report> {
        assert_eq!(user_id.as_ref(), "macro|viewer@macro.com");
        assert_eq!(scope, GraphqlPropertyDefinitionScope::System);
        assert_eq!(
            for_entity_type,
            Some(models_properties::EntityType::Initiative)
        );
        let now = chrono::Utc::now();
        Ok(vec![PropertyDefinition {
            id: Uuid::from_u128(1),
            owner: PropertyOwner::System,
            display_name: "Status".to_owned(),
            data_type: models_properties::DataType::SelectString,
            is_multi_select: false,
            specific_entity_type: None,
            created_at: now,
            updated_at: now,
            is_system: true,
            is_metadata: false,
        }])
    }

    async fn get_options(
        &self,
        user_id: &MacroUserIdStr<'static>,
        property_definition_id: Uuid,
    ) -> Result<Vec<PropertyOption>, rootcause::Report> {
        assert_eq!(user_id.as_ref(), "macro|viewer@macro.com");
        self.0.fetch_add(1, Ordering::Relaxed);
        if property_definition_id != Uuid::from_u128(1) {
            return Err(rootcause::report!("definition is not visible"));
        }
        let now = chrono::Utc::now();
        Ok(vec![PropertyOption {
            id: Uuid::from_u128(2),
            property_definition_id,
            display_order: 3,
            value: PropertyOptionValue::String("In Progress".to_owned()),
            color: None,
            created_at: now,
            updated_at: now,
        }])
    }

    async fn get_properties(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _keys: &[model_entity::Entity<'static>],
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<EntityPropertyWithDefinition>>,
        rootcause::Report,
    > {
        Ok(HashMap::new())
    }
}

/// Minimal schema exposing the same viewer-edge resolver functions.
struct Query;

#[Object]
impl Query {
    /// Definitions scoped to the authenticated caller.
    async fn definitions(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlPropertyDefinition<TestReader>>> {
        load_property_definitions::<TestReader>(
            ctx,
            GraphqlPropertyDefinitionScope::System,
            Some(GraphqlPropertyEntityType::Initiative),
        )
        .await
    }

    /// Read an option list by definition reference.
    async fn options(
        &self,
        ctx: &Context<'_>,
        definition_id: ID,
    ) -> async_graphql::Result<Vec<GraphqlPropertyOption>> {
        load_property_options::<TestReader>(ctx, definition_id).await
    }
}

/// Construct an isolated request-scoped schema.
fn schema(calls: Arc<AtomicUsize>) -> Schema<Query, EmptyMutation, EmptySubscription> {
    Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(entity_properties_loader(
            MacroUserIdStr::parse_from_str("macro|viewer@macro.com").expect("valid user"),
            TestReader(calls),
        ))
        .finish()
}

#[tokio::test]
async fn definitions_do_not_read_unselected_options() {
    let calls = Arc::new(AtomicUsize::new(0));
    let response = schema(calls.clone())
        .execute("{ definitions { id displayName owner { scope principalId } } }")
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("JSON result");
    assert_eq!(data["definitions"][0]["id"], Uuid::from_u128(1).to_string());
    assert_eq!(data["definitions"][0]["owner"]["scope"], "SYSTEM");
    assert!(data["definitions"][0]["owner"]["principalId"].is_null());
    assert_eq!(calls.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn selected_options_have_distinct_global_identity_and_typed_values() {
    let response = schema(Arc::default()).execute("{ definitions { id options { id propertyDefinitionId value { __typename ... on GraphqlStringPropertyOptionValue { value } } } } }").await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("JSON result");
    let option = &data["definitions"][0]["options"][0];
    assert_eq!(option["id"], Uuid::from_u128(2).to_string());
    assert_eq!(
        option["propertyDefinitionId"],
        Uuid::from_u128(1).to_string()
    );
    assert_eq!(
        option["value"]["__typename"],
        "GraphqlStringPropertyOptionValue"
    );
    assert_eq!(option["value"]["value"], "In Progress");
}

#[tokio::test]
async fn invalid_option_reference_is_rejected_before_reading() {
    let calls = Arc::new(AtomicUsize::new(0));
    let response = schema(calls.clone())
        .execute("{ options(definitionId: \"not-a-uuid\") { id } }")
        .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn invisible_definition_error_is_not_returned_as_an_empty_option_list() {
    let response = schema(Arc::default())
        .execute(format!(
            "{{ options(definitionId: \"{}\") {{ id }} }}",
            Uuid::from_u128(3)
        ))
        .await;
    assert_eq!(response.errors.len(), 1);
    assert!(
        response.errors[0]
            .message
            .contains("definition is not visible")
    );
}

#[tokio::test]
async fn schema_only_reader_fails_closed_if_executed() {
    let user = MacroUserIdStr::parse_from_str("macro|viewer@macro.com").expect("valid user");
    assert!(
        NoOpEntityPropertyReader
            .get_definitions(&user, GraphqlPropertyDefinitionScope::All, None)
            .await
            .is_err()
    );
    assert!(
        NoOpEntityPropertyReader
            .get_options(&user, Uuid::from_u128(1))
            .await
            .is_err()
    );
}
