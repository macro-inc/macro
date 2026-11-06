use super::*;

#[tokio::test]
async fn computers_not_sold_answers_service_unavailable() {
    let response = ComputersHttpError::from(ComputerError::Billing(BillingError::NotAvailable))
        .into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["message"],
        "computers are not available in this environment"
    );
}
