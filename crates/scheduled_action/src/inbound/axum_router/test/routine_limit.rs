use super::*;

#[tokio::test]
async fn activating_past_the_plan_limit_is_payment_required_with_a_code() {
    let app = router(false);
    for _ in 0..10 {
        let (status, _) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let (status, body) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(body["code"], "routine_limit_reached");
    assert_eq!(body["limit"], 10);
    assert_eq!(body["plan"], "free");
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|error| error.contains("10"))
    );

    let mut paused = legacy();
    paused["enabled"] = json!(false);
    let (status, created) = request(&app, "POST", "/scheduled-actions", "owner", paused).await;
    assert_eq!(status, StatusCode::CREATED);
    let url = format!(
        "/scheduled-actions/{}/enabled",
        created["id"].as_str().unwrap()
    );
    let (status, body) = request(&app, "PUT", &url, "owner", json!({"enabled": true})).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(body["code"], "routine_limit_reached");
}
