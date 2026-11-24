//! Contract coverage for the viewer's tag sets.

use std::collections::HashMap;

use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{
    DataType, PropertyOwner,
    service::{
        entity_property_with_definition::EntityPropertyWithDefinition,
        property_definition::PropertyDefinition,
        property_option::{PropertyOption, PropertyOptionValue},
    },
};
use uuid::Uuid;

use super::*;
use crate::{GraphqlPropertyDefinitionScope, NoOpEntityPropertyReader, entity_properties_loader};

const VIEWER: &str = "macro|viewer@macro.com";

/// Reader answering with a provisioned personal set and an unprovisioned team set.
struct TestReader;

impl EntityPropertyReader for TestReader {
    async fn get_definitions(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _scope: GraphqlPropertyDefinitionScope,
        _for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<Vec<PropertyDefinition>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn get_definitions_with_options(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _scope: GraphqlPropertyDefinitionScope,
        _for_entity_type: Option<models_properties::EntityType>,
    ) -> Result<
        Vec<models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions>,
        rootcause::Report,
    >{
        Ok(Vec::new())
    }

    async fn get_options(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _property_definition_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<PropertyOption>>, rootcause::Report> {
        Ok(HashMap::new())
    }

    async fn get_tag_sets(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<TagSet>, rootcause::Report> {
        assert_eq!(user_id.as_ref(), VIEWER);
        let now = chrono::Utc::now();
        let definition_id = Uuid::from_u128(1);
        Ok(vec![
            TagSet {
                scope: TagScope::User,
                definition: Some(PropertyDefinition {
                    id: definition_id,
                    owner: PropertyOwner::User {
                        user_id: VIEWER.to_owned(),
                    },
                    display_name: "Tags".to_owned(),
                    data_type: DataType::Tag,
                    is_multi_select: true,
                    specific_entity_type: None,
                    created_at: now,
                    updated_at: now,
                    is_system: false,
                    is_metadata: false,
                }),
                options: vec![PropertyOption {
                    id: Uuid::from_u128(2),
                    property_definition_id: definition_id,
                    display_order: 0,
                    value: PropertyOptionValue::String("Urgent".to_owned()),
                    color: Some("red".to_owned()),
                    created_at: now,
                    updated_at: now,
                }],
            },
            TagSet {
                scope: TagScope::Team,
                definition: None,
                options: Vec::new(),
            },
        ])
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

/// Minimal schema exposing the viewer-edge resolver.
struct Query;

#[Object]
impl Query {
    /// The viewer's tag sets.
    async fn tag_sets(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlTagSet<TestReader>>> {
        load_tag_sets::<TestReader>(ctx).await
    }
}

fn schema() -> Schema<Query, EmptyMutation, EmptySubscription> {
    Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(entity_properties_loader(
            MacroUserIdStr::parse_from_str(VIEWER).expect("valid user"),
            TestReader,
        ))
        .finish()
}

#[tokio::test]
async fn tag_sets_list_provisioned_and_unprovisioned_sets_with_labels() {
    let response = schema()
        .execute(
            "{ tagSets { scope definition { id dataType owner { scope } } \
             options { id propertyDefinitionId displayOrder color \
             value { ... on GraphqlStringPropertyOptionValue { value } } } } }",
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("JSON result");
    let personal = &data["tagSets"][0];
    assert_eq!(personal["scope"], "USER");
    assert_eq!(personal["definition"]["id"], Uuid::from_u128(1).to_string());
    assert_eq!(personal["definition"]["dataType"], "TAG");
    assert_eq!(personal["definition"]["owner"]["scope"], "USER");
    assert_eq!(personal["options"][0]["id"], Uuid::from_u128(2).to_string());
    assert_eq!(personal["options"][0]["value"]["value"], "Urgent");
    assert_eq!(personal["options"][0]["color"], "red");

    // An unprovisioned team set is still listed: it says the viewer is on a team.
    let team = &data["tagSets"][1];
    assert_eq!(team["scope"], "TEAM");
    assert!(team["definition"].is_null());
    assert_eq!(team["options"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn schema_only_reader_fails_closed_for_tag_sets() {
    let user = MacroUserIdStr::parse_from_str(VIEWER).expect("valid user");
    assert!(NoOpEntityPropertyReader.get_tag_sets(&user).await.is_err());
}

/// Exposes the tag sets through a reader whose reads fail.
struct FailingQuery;

#[Object]
impl FailingQuery {
    /// The viewer's tag sets.
    async fn tag_sets(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlTagSet<NoOpEntityPropertyReader>>> {
        load_tag_sets::<NoOpEntityPropertyReader>(ctx).await
    }
}

#[tokio::test]
async fn a_failed_tag_set_read_answers_a_coded_generic_error() {
    let response = Schema::build(FailingQuery, EmptyMutation, EmptySubscription)
        .data(entity_properties_loader(
            MacroUserIdStr::parse_from_str(VIEWER).expect("valid user"),
            NoOpEntityPropertyReader,
        ))
        .finish()
        .execute("{ tagSets { scope } }")
        .await;
    let [error] = response.errors.as_slice() else {
        panic!("one error expected: {:?}", response.errors);
    };
    assert_eq!(error.message, "property catalog read failed");
    assert_eq!(
        error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("code"))
            .cloned(),
        Some(async_graphql::Value::from("INTERNAL"))
    );
}

#[tokio::test]
async fn a_tag_definitions_options_come_from_the_set_without_another_read() {
    // The test reader's options batch finds nothing, so a second read would
    // fail the field as not visible.
    let response = schema()
        .execute("{ tagSets { definition { options { id } } } }")
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("JSON result");
    assert_eq!(
        data["tagSets"][0]["definition"]["options"][0]["id"],
        Uuid::from_u128(2).to_string()
    );
}
