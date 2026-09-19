use std::sync::Arc;

use async_graphql::{
    Context, EmptySubscription, MaybeUndefined, Object, Request, Schema, SimpleObject, value,
};
use entity_mutation::{
    EntityMutationActor, EntityMutationEffect, UnavailableEntityMutationService,
};
use graphql_permission::GraphqlEntityAccessLevel;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::{LinkShare, access_level::AccessLevel};

/// Minimal composed Soup edge object used by the isolated mutation schema.
#[derive(Clone, SimpleObject)]
struct TestSoupEdges {
    /// Keeps the GraphQL object non-empty.
    available: bool,
}

/// Minimal email-specific edge object used by the isolated mutation schema.
#[derive(Clone, SimpleObject)]
struct TestEmailThreadEdges {
    /// Keeps the GraphQL object non-empty.
    available: bool,
}

impl SoupEntityEdges for TestSoupEdges {
    type Property = String;
    type Notification = String;
    type ActivityEvent = String;
    type EmailThreadEdges = TestEmailThreadEdges;

    fn from_entity(_entity: Entity<'static>) -> Self {
        Self { available: true }
    }

    fn email_thread_edges(_email_thread_id: uuid::Uuid) -> Self::EmailThreadEdges {
        TestEmailThreadEdges { available: true }
    }

    async fn resolve_properties(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Property>> {
        Ok(Vec::new())
    }

    async fn resolve_notifications(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Notification>> {
        Ok(Vec::new())
    }

    async fn resolve_is_favorited(&self, _ctx: &Context<'_>) -> async_graphql::Result<bool> {
        Ok(false)
    }

    async fn resolve_viewer_permission(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_permission::GraphqlEntityPermission>> {
        Ok(None)
    }

    async fn resolve_activity(
        &self,
        _ctx: &Context<'_>,
        _limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Self::ActivityEvent>> {
        Ok(Vec::new())
    }
}

/// Minimal query root used to exercise the mutation module in isolation.
struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Return a trivial value so the test schema has a valid query root.
    async fn health(&self) -> bool {
        true
    }

    /// Return a successful domain outcome whose deletion cannot be represented by Soup.
    async fn unsupported_deletion(&self) -> super::GraphqlMutationSuccess<TestSoupEdges> {
        super::GraphqlMutationSuccess {
            effects: vec![EntityMutationEffect::deleted(
                EntityType::User.with_entity_string("user-1".to_string()),
            )],
            edges: std::marker::PhantomData,
        }
    }
}

#[tokio::test]
async fn mutation_results_return_typed_errors() {
    let service = Arc::new(UnavailableEntityMutationService);
    let actor = EntityMutationActor {
        user_id: MacroUserIdStr::parse_from_str("macro|graphql-test@example.com").unwrap(),
        organization_id: Some(42),
    };
    let request = Request::new(
        r#"
        mutation {
          renameEntities(
            inputs: [{
              entity: { type: DOCUMENT, id: "document-1" }
              displayName: "Renamed"
            }]
          ) {
            results {
              __typename
              ... on GraphqlMutationSuccess {
                effects {
                  __typename
                  ... on GraphqlCacheDeletion { graphqlTypeName entityId }
                }
              }
              ... on GraphqlMutationError {
                errorCode
                message
              }
            }
          }
        }
        "#,
    )
    .data(service)
    .data(actor);

    let response = Schema::build(
        QueryRoot,
        crate::EntityMutationRoot::<UnavailableEntityMutationService, TestSoupEdges>::new(),
        EmptySubscription,
    )
    .finish()
    .execute(request)
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({
            "renameEntities": {
                "results": [{
                    "__typename": "GraphqlMutationError",
                    "errorCode": "UNSUPPORTED_OPERATION",
                    "message": "Operation is not supported for this entity",
                }],
            },
        })
    );
}

#[tokio::test]
async fn unsupported_soup_deletion_is_a_graphql_error() {
    let actor = EntityMutationActor {
        user_id: MacroUserIdStr::parse_from_str("macro|graphql-test@example.com").unwrap(),
        organization_id: Some(42),
    };
    let response = Schema::build(QueryRoot, async_graphql::EmptyMutation, EmptySubscription)
        .finish()
        .execute(Request::new("{ unsupportedDeletion { effects { __typename } } }").data(actor))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(
        response.errors[0]
            .message
            .contains("cannot be represented as a Soup cache deletion")
    );
}

#[test]
fn batch_validation_rejects_oversized_and_duplicate_requests() {
    let oversized = (0..=super::MAX_ENTITY_MUTATION_BATCH).map(|index| {
        (
            graphql_common::GraphqlEntityType::Document,
            format!("document-{index}"),
        )
    });
    let error = super::validate_batch("renameEntities", oversized).unwrap_err();
    assert!(error.message.contains("accepts at most"));

    let duplicate = [
        (
            graphql_common::GraphqlEntityType::Document,
            "document-1".to_owned(),
        ),
        (
            graphql_common::GraphqlEntityType::Document,
            "document-1".to_owned(),
        ),
    ];
    let error = super::validate_batch("renameEntities", duplicate).unwrap_err();
    assert!(error.message.contains("duplicate entity"));
}

fn share_policy_input(
    link_share: MaybeUndefined<super::GraphqlLinkShare>,
    link_share_access_level: MaybeUndefined<GraphqlEntityAccessLevel>,
) -> super::EntitySharePolicyInput {
    super::EntitySharePolicyInput {
        link_share,
        link_share_access_level,
        channel_share_permissions: None,
    }
}

fn share_policy_update_input(
    link_share: MaybeUndefined<super::GraphqlLinkShare>,
    link_share_access_level: MaybeUndefined<GraphqlEntityAccessLevel>,
) -> super::UpdateEntitySharePolicyInput {
    super::UpdateEntitySharePolicyInput {
        entity: super::EntityRefInput {
            entity_type: graphql_common::GraphqlEntityType::Document,
            id: "document-1".into(),
        },
        policy: share_policy_input(link_share, link_share_access_level),
    }
}

#[test]
fn share_policy_input_preserves_undefined_and_null_link_updates() {
    let unchanged =
        share_policy_input(MaybeUndefined::Undefined, MaybeUndefined::Undefined).into_model();
    assert_eq!(unchanged.link_share, None);
    assert_eq!(unchanged.link_share_access_level, None);

    let disabled = share_policy_input(MaybeUndefined::Null, MaybeUndefined::Null).into_model();
    assert_eq!(disabled.link_share, Some(None));
    assert_eq!(disabled.link_share_access_level, Some(None));
}

#[test]
fn share_policy_input_converts_public_and_team_link_updates() {
    let public = share_policy_input(
        MaybeUndefined::Value(super::GraphqlLinkShare::Public),
        MaybeUndefined::Value(GraphqlEntityAccessLevel::View),
    )
    .into_model();
    assert_eq!(public.link_share, Some(Some(LinkShare::Public)));
    assert_eq!(
        public.link_share_access_level,
        Some(Some(AccessLevel::View))
    );

    let team = share_policy_input(
        MaybeUndefined::Value(super::GraphqlLinkShare::Team),
        MaybeUndefined::Value(GraphqlEntityAccessLevel::Edit),
    )
    .into_model();
    assert_eq!(team.link_share, Some(Some(LinkShare::Team)));
    assert_eq!(team.link_share_access_level, Some(Some(AccessLevel::Edit)));
}

#[test]
fn share_policy_validation_allows_undefined_and_null_link_updates() {
    let unchanged = [share_policy_update_input(
        MaybeUndefined::Undefined,
        MaybeUndefined::Undefined,
    )];
    super::validate_share_policy_inputs(&unchanged).unwrap();

    let disabled = [share_policy_update_input(
        MaybeUndefined::Null,
        MaybeUndefined::Undefined,
    )];
    super::validate_share_policy_inputs(&disabled).unwrap();
}

#[test]
fn share_policy_validation_requires_access_levels_for_public_and_team_links() {
    for link_share in [
        super::GraphqlLinkShare::Public,
        super::GraphqlLinkShare::Team,
    ] {
        for link_share_access_level in [MaybeUndefined::Undefined, MaybeUndefined::Null] {
            let inputs = [share_policy_update_input(
                MaybeUndefined::Value(link_share),
                link_share_access_level,
            )];
            let error = super::validate_share_policy_inputs(&inputs).unwrap_err();
            assert!(error.message.contains("linkShareAccessLevel is required"));
        }

        let inputs = [share_policy_update_input(
            MaybeUndefined::Value(link_share),
            MaybeUndefined::Value(GraphqlEntityAccessLevel::View),
        )];
        super::validate_share_policy_inputs(&inputs).unwrap();
    }
}

#[test]
fn share_policy_validation_requires_access_levels_for_channel_grants() {
    let inputs = [super::UpdateEntitySharePolicyInput {
        entity: super::EntityRefInput {
            entity_type: graphql_common::GraphqlEntityType::Document,
            id: "document-1".into(),
        },
        policy: super::EntitySharePolicyInput {
            link_share: MaybeUndefined::Undefined,
            link_share_access_level: MaybeUndefined::Undefined,
            channel_share_permissions: Some(vec![super::ChannelSharePolicyInput {
                operation: super::GraphqlSharePolicyOperation::Add,
                channel_id: "channel-1".into(),
                access_level: None,
            }]),
        },
    }];
    let error = super::validate_share_policy_inputs(&inputs).unwrap_err();
    assert!(error.message.contains("accessLevel is required"));
}
