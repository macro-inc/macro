use super::*;
use models_properties::service::{
    entity_property::EntityProperty, entity_property_with_definition::EntityPropertyWithDefinition,
    property_definition::PropertyDefinition, property_value::PropertyValue,
};

type OptionsSchema = SoupSchema<
    CountingSoupService,
    NoOpSoupRealtimeSubscriptionService,
    NoopWebSocketNotificationSubscriptionService,
    graphql_activity::NoOpActivitySubscriptionService,
    NoOpEmailService,
    NoOpEntityAccessService,
    SchemaOnlyAuthorizationService,
    SchemaOnlyState,
    CommittedWriter,
    UnavailableEntityMutationService,
    NoOpFavoriteMutationService,
    NoOpChannelActivityMutationService,
    NoOpNotificationMutationService,
    NoOpSoupNotificationEdgeReader,
    CommittedReader,
    NoOpSoupEmailContentEdgeReader,
    NoOpEntityFavoriteEdgeReader,
    NoOpEntityPermissionEdgeReader,
    NoOpActivityReader,
>;

/// A user-owned multi-select tag assignment on `document_id`.
fn tag_property(
    document_id: Uuid,
    assignment_id: u128,
    definition_id: u128,
    option_id: u128,
) -> EntityPropertyWithDefinition {
    let now = chrono::Utc::now();
    let property_definition_id = Uuid::from_u128(definition_id);
    EntityPropertyWithDefinition {
        property: EntityProperty {
            id: Uuid::from_u128(assignment_id),
            entity_id: document_id.to_string(),
            entity_type: models_properties::EntityType::Document,
            property_definition_id,
            created_at: now,
            updated_at: now,
        },
        definition: PropertyDefinition {
            id: property_definition_id,
            owner: models_properties::PropertyOwner::User {
                user_id: VALID_USER_ID.to_owned(),
            },
            display_name: "Tags".to_owned(),
            data_type: models_properties::DataType::Tag,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: now,
            updated_at: now,
            is_system: false,
            is_metadata: false,
        },
        value: Some(PropertyValue::SelectOption(vec![Uuid::from_u128(
            option_id,
        )])),
        options: None,
    }
}

/// Writer returning the newly created assignment as committed.
#[derive(Clone)]
struct CommittedWriter {
    created: EntityPropertyWithDefinition,
}

impl EntityPropertyWriter for CommittedWriter {
    async fn set_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _property_definition_id: Uuid,
        _value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        Err(rootcause::report!("unused"))
    }

    async fn update_entity_property_options(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _updates: Vec<graphql_properties::EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        Ok(vec![self.created.clone()])
    }
}

/// Reader returning the entity's post-commit assignments.
#[derive(Clone)]
struct CommittedReader {
    properties: Vec<EntityPropertyWithDefinition>,
}

impl EntityPropertyReader for CommittedReader {
    async fn get_properties(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        keys: &[model_entity::Entity<'static>],
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<EntityPropertyWithDefinition>>,
        rootcause::Report,
    > {
        Ok(keys
            .iter()
            .cloned()
            .map(|key| (key, self.properties.clone()))
            .collect())
    }
}

#[tokio::test]
async fn apply_option_deltas_refreshes_the_entity_with_every_assignment() {
    let document_id = Uuid::from_u128(42);
    let existing = tag_property(document_id, 1, 11, 21);
    let created = tag_property(document_id, 2, 12, 22);
    let soup = CountingSoupService::default();
    soup.set_raw_response(vec![soup_document(document_id)]);
    let user_id = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    let schema: OptionsSchema = build_schema_with_service(soup.clone());
    let request = async_graphql::Request::new(format!(
        r#"
        mutation {{
            applyEntityPropertyOptionDeltas(input: {{
                entityType: DOCUMENT,
                entityId: "{document_id}",
                properties: [{{
                    propertyDefinitionId: "{definition_id}",
                    addOptionIds: ["{option_id}"],
                    removeOptionIds: []
                }}]
            }}) {{
                properties {{ id }}
                effects {{
                    __typename
                    ... on SoupUpdated {{
                        item {{ __typename id properties {{ id }} }}
                    }}
                }}
            }}
        }}
        "#,
        definition_id = Uuid::from_u128(12),
        option_id = Uuid::from_u128(22),
    ))
    .data(user_id.clone())
    .data(CommittedWriter {
        created: created.clone(),
    })
    .data(graphql_soup::soup_item_loader(
        soup,
        Arc::new(NoOpEmailService),
    ))
    .data(graphql_properties::entity_properties_loader(
        user_id,
        CommittedReader {
            properties: vec![existing, created],
        },
    ));

    let response = schema.execute(request).await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({
            "applyEntityPropertyOptionDeltas": {
                "properties": [{ "id": Uuid::from_u128(2).to_string() }],
                "effects": [{
                    "__typename": "SoupUpdated",
                    "item": {
                        "__typename": "GraphqlSoupDocument",
                        "id": document_id.to_string(),
                        "properties": [
                            { "id": Uuid::from_u128(1).to_string() },
                            { "id": Uuid::from_u128(2).to_string() },
                        ],
                    },
                }],
            }
        })
    );
}
