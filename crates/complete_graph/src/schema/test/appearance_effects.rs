use super::{CountingSoupService, NoOpEmailService, NoOpEntityAccessService, VALID_USER_ID};
use async_graphql::{EmptySubscription, Object, PathSegment, Schema, value};
use entity_mutation::{
    DuplicateEntityRequest, EntityMutationActor, EntityMutationEffect, EntityMutationService,
    EntityMutationSuccess, MoveEntityRequest, MutateEntitiesResult, RenameEntityRequest,
    UnavailableEntityMutationService, UpdateEntitySharePolicyRequest,
};
use graphql_entity_mutation::EntityMutationRoot;
use graphql_soup::PrimarySoupItemLoader;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityAppearance};
use std::sync::Arc;

/// Composed Soup edges with no external readers for the isolated schema.
type AppearanceTestEdges = super::SoupEdges<
    super::NoOpSoupNotificationEdgeReader,
    super::NoOpEntityPropertyReader,
    super::NoOpSoupEmailContentEdgeReader,
    super::NoOpEntityFavoriteEdgeReader,
    super::NoOpEntityPermissionEdgeReader,
    super::NoOpActivityReader,
>;

/// Supplies a committed appearance outcome without invoking storage.
struct AppearanceTestService;

impl EntityMutationService for AppearanceTestService {
    async fn set_appearance(
        &self,
        _actor: EntityMutationActor,
        entity: Entity<'static>,
        _appearance: EntityAppearance,
    ) -> MutateEntitiesResult {
        Ok(EntityMutationSuccess {
            effects: vec![EntityMutationEffect::updated(entity)],
        })
    }

    async fn rename_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .rename_entities(actor, requests)
            .await
    }

    async fn move_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .move_entities(actor, requests)
            .await
    }

    async fn update_share_policies(
        &self,
        actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .update_share_policies(actor, requests)
            .await
    }

    async fn trash_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .trash_entities(actor, entities)
            .await
    }

    async fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .restore_entities(actor, entities)
            .await
    }

    async fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .delete_entities_permanently(actor, entities)
            .await
    }

    async fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<MutateEntitiesResult> {
        UnavailableEntityMutationService
            .duplicate_entities(actor, requests)
            .await
    }
}

/// Minimal query required by the isolated mutation schema.
struct AppearanceTestQuery;

#[Object]
impl AppearanceTestQuery {
    /// Keep the test schema's query root nonempty.
    async fn health(&self) -> bool {
        true
    }
}

#[tokio::test]
async fn missing_appearance_row_is_reported_without_losing_the_commit() {
    let soup = CountingSoupService::default();
    soup.set_raw_response(Vec::new());
    let schema = Schema::build(
        AppearanceTestQuery,
        EntityMutationRoot::<AppearanceTestService, AppearanceTestEdges>::new(),
        EmptySubscription,
    )
    .data(Arc::new(AppearanceTestService))
    .data(PrimarySoupItemLoader::new(
        soup,
        Arc::new(NoOpEmailService),
        NoOpEntityAccessService,
    ))
    .data(EntityMutationActor {
        user_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        organization_id: None,
    })
    .finish();
    let response = schema
        .execute(
            r#"
            mutation {
              setEntityAppearance(input: {
                entity: { type: DOCUMENT, id: "00000000-0000-0000-0000-000000000001" }
                color: GREEN
              }) {
                __typename
                effects { __typename }
              }
            }
            "#,
        )
        .await;
    assert_eq!(
        response.data,
        value!({
            "setEntityAppearance": { "__typename": "GraphqlMutationSuccess", "effects": [] }
        })
    );
    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0].path,
        [
            PathSegment::Field("setEntityAppearance".into()),
            PathSegment::Field("effects".into()),
        ]
    );
}
