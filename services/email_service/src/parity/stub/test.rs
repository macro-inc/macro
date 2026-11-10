use super::Stub;
use serde_json::json;

#[tokio::test]
async fn response_headers_are_opt_in_and_scoped_to_the_selected_path() {
    let stub = Stub::start().await;
    stub.reply("GET", "/people/test", 429, json!({"error":"limited"}));
    stub.reply_header("/people/", "retry-after", "3600");
    let client = reqwest::Client::new();
    let limited = client
        .get(format!("{}/people/test", stub.url))
        .send()
        .await
        .expect("provider reply");
    assert_eq!(limited.status().as_u16(), 429);
    assert_eq!(limited.headers()["retry-after"], "3600");
    let ordinary = client
        .get(format!("{}/ordinary", stub.url))
        .send()
        .await
        .expect("ordinary reply");
    assert_eq!(ordinary.status().as_u16(), 200);
    assert!(!ordinary.headers().contains_key("retry-after"));
}
