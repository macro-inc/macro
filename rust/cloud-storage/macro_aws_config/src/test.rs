use super::*;

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
