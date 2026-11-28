use async_graphql::{EmptySubscription, Object, Request, Schema};
use graphql_properties::{EntityPropertyOptionDelta, PropertyCatalogWriter};
use graphql_soup::PrimarySoupItemLoader;
use model_entity::Entity;
use models_properties::{
    api::requests::SetPropertyValue,
    service::entity_property_with_definition::EntityPropertyWithDefinition,
};

use super::*;
use crate::entity_property_effects::EntityPropertyEffectsRoot;

type TestEdges = SoupEdges<
    NoOpSoupNotificationEdgeReader,
    NoOpEntityPropertyReader,
    NoOpSoupEmailContentEdgeReader,
    NoOpEntityFavoriteEdgeReader,
    NoOpEntityPermissionEdgeReader,
    NoOpActivityReader,
>;

struct TestQuery;

#[Object]
impl TestQuery {
    async fn health(&self) -> bool {
        true
    }
}

struct Writer(CountingSoupService);

impl PropertyCatalogWriter for Writer {}

impl EntityPropertyWriter for Writer {
    async fn apply_entity_property_options(
        &self,
        entity: Entity<'static>,
        updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<(), Report> {
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].property_definition_id, Uuid::from_u128(2));
        assert_eq!(updates[0].add_option_ids, vec![Uuid::from_u128(3)]);
        assert!(updates[0].remove_option_ids.is_empty());
        let id = entity.entity_id.parse().expect("entity ID");
        let row = match entity.entity_type {
            ModelEntityType::Document => soup_document(id),
            ModelEntityType::Project => soup_project(id),
            _ => panic!("unexpected property target"),
        };
        // The row becomes visible to hydration once the write completes.
        self.0.set_raw_response(vec![row]);
        Ok(())
    }

    async fn delete_entity_property(
        &self,
        _: ModelEntityType,
        _: String,
        _: Uuid,
    ) -> Result<(), Report> {
        unreachable!()
    }

    async fn set_entity_property(
        &self,
        _: ModelEntityType,
        _: String,
        _: Uuid,
        _: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, Report> {
        unreachable!()
    }

    async fn update_entity_property_options(
        &self,
        _: ModelEntityType,
        _: String,
        _: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, Report> {
        unreachable!()
    }
}

#[tokio::test]
async fn composer_tag_write_hydrates_the_committed_parent_from_the_primary() {
    let schema = Schema::new(
        TestQuery,
        EntityPropertyEffectsRoot::<Writer, TestEdges>::default(),
        EmptySubscription,
    );
    for (entity_type, typename) in [
        ("DOCUMENT", "GraphqlSoupDocument"),
        ("PROJECT", "GraphqlSoupProject"),
    ] {
        let primary = CountingSoupService::default();
        let id = Uuid::from_u128(1);
        let definition = Uuid::from_u128(2);
        let option = Uuid::from_u128(3);
        let request = Request::new(format!(
            "mutation {{ updateSoupEntityPropertyOptions(input: {{
                entityType: {entity_type}, entityId: \"{id}\",
                properties: [{{ propertyDefinitionId: \"{definition}\",
                    addOptionIds: [\"{option}\"], removeOptionIds: [] }}]
            }}) {{ effect {{ ... on SoupUpdated {{ item {{ __typename id }} }} }} }} }}"
        ))
        .data(Writer(primary.clone()))
        .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).expect("test user"))
        .data(PrimarySoupItemLoader::new(
            primary.clone(),
            Arc::new(NoOpEmailService),
            NoOpEntityAccessService,
        ));
        let response = schema.execute(request).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let data = response.data.into_json().expect("JSON response");
        assert_eq!(
            data["updateSoupEntityPropertyOptions"]["effect"]["item"],
            serde_json::json!({ "__typename": typename, "id": id.to_string() })
        );
        assert_eq!(primary.raw_calls.load(Ordering::SeqCst), 1);
    }
}
