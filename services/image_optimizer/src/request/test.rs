use super::*;
use crate::transform::TransformParams;

fn event(raw_path: &str) -> serde_json::Value {
    serde_json::json!({ "rawPath": raw_path })
}

#[test]
fn original_file() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/file/abc-123")).unwrap();
    assert_eq!(req.path.file_id.as_deref(), Some("abc-123"));
    assert_eq!(req.path.transform_suffix, None);
}

#[test]
fn variant_with_suffix() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/file/abc-123/size=1080")).unwrap();
    assert_eq!(req.path.file_id.as_deref(), Some("abc-123"));
    assert_eq!(req.path.transform_suffix.as_deref(), Some("size=1080"));
}

#[test]
fn uuid_file_id() {
    let req: FunctionUrlRequest =
        serde_json::from_value(event("/file/e2df5846-c391-4df6-952b-c2bb259c9ea7/size=720"))
            .unwrap();
    assert_eq!(
        req.path.file_id.as_deref(),
        Some("e2df5846-c391-4df6-952b-c2bb259c9ea7")
    );
    assert_eq!(req.path.transform_suffix.as_deref(), Some("size=720"));
}

#[test]
fn wrong_prefix() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/other/abc-123")).unwrap();
    assert_eq!(req.path.file_id, None);
}

#[test]
fn empty_file_id() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/file/")).unwrap();
    assert_eq!(req.path.file_id, None);
}

#[test]
fn trailing_slash_no_suffix() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/file/abc-123/")).unwrap();
    assert_eq!(req.path.file_id, None);
}

#[test]
fn root_path() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/")).unwrap();
    assert_eq!(req.path.file_id, None);
}

#[test]
fn suffix_roundtrip() {
    let req: FunctionUrlRequest = serde_json::from_value(event("/file/abc/size=500")).unwrap();
    let suffix = req.path.transform_suffix.as_deref().unwrap();
    let params = TransformParams::from_suffix(suffix).unwrap();
    assert_eq!(params.size, 500);
}

#[test]
fn suffix_missing_size_returns_none() {
    assert!(TransformParams::from_suffix("other=123").is_none());
}

#[test]
fn suffix_size_zero_returns_none() {
    assert!(TransformParams::from_suffix("size=0").is_none());
}

#[test]
fn suffix_size_over_max_returns_none() {
    assert!(TransformParams::from_suffix("size=9999").is_none());
}

#[test]
fn lambda_request_dispatches_async_resize() {
    let payload = serde_json::json!({
        "original_key": "file/abc",
        "transformed_s3_key": "file/abc/size=1080",
        "size": 1080
    });
    let req: LambdaRequest = serde_json::from_value(payload).unwrap();
    assert!(matches!(req, LambdaRequest::AsyncResize(_)));
}

#[test]
fn lambda_request_dispatches_function_url() {
    let req: LambdaRequest = serde_json::from_value(event("/file/abc")).unwrap();
    assert!(matches!(req, LambdaRequest::FunctionUrl(_)));
}
