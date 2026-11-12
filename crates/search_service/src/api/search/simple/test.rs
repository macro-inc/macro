use super::*;

#[test]
fn test_too_many_clauses_is_a_bad_request() {
    let err = SearchError::from(OpensearchClientError::TooManyClauses {
        message: "too_many_nested_clauses".to_string(),
    });

    assert!(matches!(err, SearchError::QueryTooComplex(_)));
    assert_eq!(err.into_response().status(), StatusCode::BAD_REQUEST);
}

#[test]
fn test_other_opensearch_errors_stay_internal() {
    let err = SearchError::from(OpensearchClientError::NetworkError {
        status_code: 503,
        message: "unavailable".to_string(),
    });

    assert!(matches!(err, SearchError::Search(_)));
    assert_eq!(
        err.into_response().status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
}
