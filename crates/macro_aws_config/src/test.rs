use super::*;

#[test]
fn public_storage_roundtrip_preserves_encoded_paths_and_signature_query() {
    let base = parse_public_base("https://forge.tail66c63e.ts.net:3000/s3").unwrap();
    let raw = "http://localstack:4566/doc-storage/a%2Fb%20c%25%7C%40/file?X-Amz-Credential=test%2Fregion&X-Amz-SignedHeaders=host&x=1&x=2";
    let public = transform_local_url_with_public_base(raw, Some(&base));
    assert_eq!(
        public,
        raw.replacen("http://localstack:4566", base.as_str(), 1)
    );
    assert_eq!(
        transform_public_url_for_internal_fetch(&public, &base, "http://localstack:4566"),
        raw
    );
}

#[test]
fn public_origin_keeps_legacy_localhost_objects_fetchable() {
    let base = parse_public_base("https://forge:3000/s3").unwrap();
    let raw = "http://localhost:4566/doc-storage/a%2Fb?versionId=1";
    assert_eq!(
        transform_public_url_for_internal_fetch(raw, &base, "http://localstack:4566"),
        "http://localstack:4566/doc-storage/a%2Fb?versionId=1"
    );
}

#[test]
fn inverse_requires_exact_origin_and_path_prefix() {
    let base = parse_public_base("https://forge:3000/s3").unwrap();
    for raw in [
        "https://forge:3001/s3/bucket/key",
        "http://forge:3000/s3/bucket/key",
        "https://forge.evil:3000/s3/bucket/key",
        "https://forge:3000/s3evil/bucket/key",
        "https://user@forge:3000/s3/bucket/key",
        "https://forge:3000/other/key",
        "https://remote.s3.amazonaws.com/bucket/key",
    ] {
        assert_eq!(
            transform_public_url_for_internal_fetch(raw, &base, "http://localstack:4566"),
            raw
        );
    }
}

#[test]
fn invalid_public_storage_bases_are_rejected() {
    for raw in [
        "http://forge/s3",
        "https://user@forge/s3",
        "https://forge/s3/",
        "https://forge/s3?x=1",
        "https://forge/s3#x",
        "https://forge/other",
    ] {
        assert!(parse_public_base(raw).is_none(), "{raw}");
    }
}

#[test]
fn test_transform_path_style_localstack() {
    let input = "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
    let expected = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_path_style_localhost() {
    let input = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
    let expected = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_presigned_url_with_query_params_localstack() {
    let input = "http://static-file-storage.localstack:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let expected = "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_presigned_url_with_query_params_localhost() {
    let input = "http://static-file-storage.localhost:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let expected = "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_simple_url_localstack() {
    let input = "http://my-bucket.localstack:4566/some/path/to/file.txt";
    let expected = "http://localhost:4566/my-bucket/some/path/to/file.txt";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_simple_url_localhost() {
    let input = "http://my-bucket.localhost:4566/some/path/to/file.txt";
    let expected = "http://localhost:4566/my-bucket/some/path/to/file.txt";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_root_path() {
    let input = "http://bucket.localstack:4566/";
    let expected = "http://localhost:4566/bucket/";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_no_path() {
    let input = "http://bucket.localhost:4566";
    let expected = "http://localhost:4566/bucket/";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_with_simple_query() {
    let input = "http://test-bucket.localstack:4566/key?versionId=123";
    let expected = "http://localhost:4566/test-bucket/key?versionId=123";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_with_simple_query_localhost() {
    let input = "http://test-bucket.localhost:4566/key?versionId=123";
    let expected = "http://localhost:4566/test-bucket/key?versionId=123";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_default_port_localstack() {
    let input = "http://bucket.localstack/path/file.txt";
    let expected = "http://localhost:4566/bucket/path/file.txt";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_transform_url_default_port_localhost() {
    let input = "http://bucket.localhost/path/file.txt";
    let expected = "http://localhost:4566/bucket/path/file.txt";

    let result = transform_local_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_rewrites_localhost_to_localstack() {
    let input = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";
    let expected = "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";

    let result = transform_internal_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_preserves_query_params() {
    let input = "http://localhost:4566/doc-storage/key?versionId=123";
    let expected = "http://localstack:4566/doc-storage/key?versionId=123";

    let result = transform_internal_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_localstack_is_idempotent() {
    let input = "http://localstack:4566/doc-storage/key";
    let expected = "http://localstack:4566/doc-storage/key";

    let result = transform_internal_url(input);
    assert_eq!(result, expected);
}

#[test]
fn test_internal_fetch_leaves_remote_url_untouched() {
    let input = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";
    let expected = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";

    let result = transform_internal_url(input);
    assert_eq!(result, expected);
}
