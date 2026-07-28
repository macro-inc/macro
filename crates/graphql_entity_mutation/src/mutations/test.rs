use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Schema, value};
use entity_mutation::{EntityMutationActor, UnavailableEntityMutationService};
use macro_user_id::user_id::MacroUserIdStr;

/// Minimal query root used to exercise the mutation module in isolation.
struct QueryRoot;

#[Object]
impl QueryRoot {
    /// Return a trivial value so the test schema has a valid query root.
    async fn health(&self) -> bool {
        true
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
                affectedEntities { id entityType }
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
        crate::EntityMutationRoot::<UnavailableEntityMutationService>::new(),
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
