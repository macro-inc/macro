use super::*;

#[test]
fn native_images_survive_public_result_and_replay_without_base64_in_json_text() {
    let result = serde_json::json!({ "revision": "snapshot-1", "modelMedia": [{ "type": "image", "mediaType": "image/png", "data": "iVBORw0KGgo=" }] });
    let output = model_output(result.clone()).expect("valid image envelope");
    assert_eq!(output.as_content().len(), 2);
    assert_eq!(
        output.as_content().first_ref().as_json(),
        Some(&serde_json::json!({"revision":"snapshot-1"}))
    );
    assert!(matches!(
        output.as_content().iter().nth(1),
        Some(ToolResultContent::Image(_))
    ));
    assert_eq!(result_json(&output), Some(result));
}

#[test]
fn nested_untrusted_media_is_not_promoted_and_remote_urls_are_rejected() {
    let nested =
        serde_json::json!({ "canvas": { "modelMedia": [{"data":"https://example.com"}] } });
    assert_eq!(
        model_output(nested.clone()).expect("plain json").as_json(),
        Some(&nested)
    );
    assert!(model_output(serde_json::json!({"modelMedia":[{"type":"image","mediaType":"image/png","data":"https://example.com"}]})).is_err());
}
