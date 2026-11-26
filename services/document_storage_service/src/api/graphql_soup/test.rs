use super::graphql_response;
use axum::{
    body::{HttpBody, to_bytes},
    http::{HeaderValue, StatusCode},
};

#[tokio::test]
async fn serialization_preserves_data_headers_and_body_length() {
    let mut result = async_graphql::Response::new(async_graphql::value!({ "rows": [1, 2] }));
    result
        .http_headers
        .insert("x-profile-test", HeaderValue::from_static("preserved"));
    let response = graphql_response(result);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "application/graphql-response+json"
    );
    assert_eq!(response.headers()["x-profile-test"], "preserved");
    let bytes = response.body().size_hint().exact().unwrap();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(bytes, body.len() as u64);
    assert_eq!(body.as_ref(), br#"{"data":{"rows":[1,2]}}"#);
}

#[tokio::test]
async fn serialization_preserves_graphql_errors() {
    let result = async_graphql::Response::from_errors(vec![async_graphql::ServerError::new(
        "refused", None,
    )]);
    let response = graphql_response(result);
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        body.as_ref(),
        br#"{"data":null,"errors":[{"message":"refused"}]}"#
    );
}

/// GraphQL runs mutations, so no session scope reaches it where it is
/// mounted: under `items`, at the root or `/dss`, with or without an API
/// version. A moved mount fails here until the scope names it.
#[test]
fn no_scope_reaches_graphql_where_it_is_mounted() {
    use agent_correlation::scope::SessionScope;
    for prefix in ["", "/dss"] {
        for version in ["", "/v1"] {
            for (method, path) in [
                ("POST", super::GRAPHQL_PATH),
                ("GET", super::GRAPHQL_SUBSCRIPTION_PATH),
            ] {
                let path = format!("{prefix}{version}{}{path}", crate::api::ITEMS_PATH);
                for scope in [SessionScope::Generation, SessionScope::NoSend] {
                    assert!(!scope.allows(method, &path), "{scope:?} {method} {path}");
                }
            }
        }
    }
}

/// The sync stream runs only its lane documents' query operations
/// (`soup_sync_stream` refuses any other), so it writes nothing and a
/// `NoSend` run may reach it. A generation session or a dry run makes only
/// the POSTs its scope lists, which leave the stream out.
#[test]
fn only_no_send_reaches_the_sync_stream_where_it_is_mounted() {
    use agent_correlation::scope::SessionScope;
    for prefix in ["", "/dss"] {
        for version in ["", "/v1"] {
            let path = format!(
                "{prefix}{version}{}{}",
                crate::api::ITEMS_PATH,
                super::GRAPHQL_STREAM_PATH
            );
            for scope in [SessionScope::Generation, SessionScope::DryRun] {
                assert!(!scope.allows("POST", &path), "{scope:?} {path}");
            }
            assert!(SessionScope::NoSend.allows("POST", &path), "{path}");
        }
    }
}

#[test]
fn only_an_email_content_stream_page_loads_more_than_one_operation_may() {
    use super::{ContextScope, email_content_limits};
    use complete_graph::EmailContentLimits;
    use soup_sync_stream::PageBudget;

    assert_eq!(
        email_content_limits(ContextScope::SyncStreamPage(PageBudget::EmailContent {
            threads: 200,
            messages: 4_000,
        })),
        EmailContentLimits {
            max_keys: 200,
            max_messages: 4_000,
        }
    );
    // A document sent for any other lane runs as it would on `/soup/graphql`.
    for scope in [
        ContextScope::SyncStreamPage(PageBudget::Operation),
        ContextScope::Request,
        ContextScope::Subscription,
    ] {
        assert_eq!(
            email_content_limits(scope),
            EmailContentLimits::PER_OPERATION
        );
    }
}
