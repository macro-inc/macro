use super::*;

#[test]
fn test_transform_path_style_localstack() {
    let input = "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
    let expected = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_path_style_localhost() {
    let input = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
    let expected = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_presigned_url_with_query_params_localstack() {
    let input = "http://static-file-storage.localstack:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let expected = "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_presigned_url_with_query_params_localhost() {
    let input = "http://static-file-storage.localhost:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let expected = "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_simple_url_localstack() {
    let input = "http://my-bucket.localstack:4566/some/path/to/file.txt";
    let expected = "http://localhost:4566/my-bucket/some/path/to/file.txt";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_simple_url_localhost() {
    let input = "http://my-bucket.localhost:4566/some/path/to/file.txt";
    let expected = "http://localhost:4566/my-bucket/some/path/to/file.txt";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_root_path() {
    let input = "http://bucket.localstack:4566/";
    let expected = "http://localhost:4566/bucket/";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_no_path() {
    let input = "http://bucket.localhost:4566";
    let expected = "http://localhost:4566/bucket/";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_with_simple_query() {
    let input = "http://test-bucket.localstack:4566/key?versionId=123";
    let expected = "http://localhost:4566/test-bucket/key?versionId=123";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_with_simple_query_localhost() {
    let input = "http://test-bucket.localhost:4566/key?versionId=123";
    let expected = "http://localhost:4566/test-bucket/key?versionId=123";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_default_port_localstack() {
    let input = "http://bucket.localstack/path/file.txt";
    let expected = "http://localhost:4566/bucket/path/file.txt";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_default_port_localhost() {
    let input = "http://bucket.localhost/path/file.txt";
    let expected = "http://localhost:4566/bucket/path/file.txt";

    let result = transform_local_url(input, None);
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_rewrites_localhost_to_localstack() {
    let input = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";
    let expected = "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";

    let result = transform_internal_url(input, "http://localstack:4566");
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_preserves_query_params() {
    let input = "http://localhost:4566/doc-storage/key?versionId=123";
    let expected = "http://localstack:4566/doc-storage/key?versionId=123";

    let result = transform_internal_url(input, "http://localstack:4566");
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_localstack_is_idempotent() {
    let input = "http://localstack:4566/doc-storage/key";
    let expected = "http://localstack:4566/doc-storage/key";

    let result = transform_internal_url(input, "http://localstack:4566");
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_leaves_remote_url_untouched() {
    let input = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";
    let expected = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";

    let result = transform_internal_url(input, "http://localstack:4566");
    assert_eq!(result, expected);
}

#[test]
fn named_instance_uses_public_port_and_preserves_signature_and_encoded_key() {
    for input in [
        "http://localstack:4566/static-file-storage/file/pasted%20image.png?X-Amz-Signature=test&x-id=PutObject",
        "http://static-file-storage.localstack:4566/file/pasted%20image.png?X-Amz-Signature=test&x-id=PutObject",
    ] {
        let public = transform_local_url(input, Some("http://localhost:29806"));
        assert_eq!(
            public,
            "http://localhost:29806/static-file-storage/file/pasted%20image.png?X-Amz-Signature=test&x-id=PutObject"
        );
        assert_eq!(
            transform_internal_url(&public, "http://localstack:4566"),
            "http://localstack:4566/static-file-storage/file/pasted%20image.png?X-Amz-Signature=test&x-id=PutObject"
        );
    }
}

#[test]
fn host_process_keeps_its_configured_localstack_endpoint_for_internal_fetch() {
    let input = "http://localhost:29806/doc-storage/key";
    assert_eq!(
        transform_internal_url(input, "http://localhost:29806"),
        input
    );
}
