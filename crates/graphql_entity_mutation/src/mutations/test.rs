use std::sync::Arc;

use async_graphql::{Context, EmptySubscription, Object, Request, Schema, SimpleObject, value};
use entity_mutation::{
    EntityMutationActor, EntityMutationEffect, UnavailableEntityMutationService,
};
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

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

#[test]
fn share_policy_validation_requires_access_levels_for_grants() {
    let inputs = [super::UpdateEntitySharePolicyInput {
        entity: super::EntityRefInput {
            entity_type: graphql_common::GraphqlEntityType::Document,
            id: "document-1".into(),
        },
        policy: super::EntitySharePolicyInput {
            is_public: None,
            public_access_level: None,
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
