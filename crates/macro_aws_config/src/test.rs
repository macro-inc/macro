use super::*;

/// The default instance: LocalStack published on the same host port it
/// listens on inside the network.
fn default_ports() -> LocalAwsEndpoints {
    LocalAwsEndpoints::new("http://localstack:4566", "http://localhost:4566")
}

/// A named instance: Compose maps the container's 4566 to a per-instance host
/// port (`--instance editor` lands on 24006).
fn remapped_ports() -> LocalAwsEndpoints {
    LocalAwsEndpoints::new("http://localstack:4566", "http://localhost:24006")
}

const PRESIGNED_QUERY: &str = "x-id=PutObject&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ANOTREAL%2F20260203%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260203T184319Z&X-Amz-Expires=120&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=deed6b123a18335b61567eaf8ddb7ea6e00bf264cfd80cb0f4031860235dc077";

mod to_public_url {
    use super::*;

    #[test]
    fn path_style_localstack() {
        let input =
            "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
        assert_eq!(
            default_ports().to_public_url(input),
            "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject"
        );
        assert_eq!(
            remapped_ports().to_public_url(input),
            "http://localhost:24006/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject"
        );
    }

    #[test]
    fn path_style_localhost() {
        let input =
            "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject";
        assert_eq!(default_ports().to_public_url(input), input);
        assert_eq!(
            remapped_ports().to_public_url(input),
            "http://localhost:24006/doc-storage/macro%7Cteo%40macro.com/doc/1?x-id=PutObject"
        );
    }

    #[test]
    fn presigned_url_with_query_params_localstack() {
        let input = format!(
            "http://static-file-storage.localstack:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?{PRESIGNED_QUERY}"
        );
        assert_eq!(
            default_ports().to_public_url(&input),
            format!(
                "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?{PRESIGNED_QUERY}"
            )
        );
        assert_eq!(
            remapped_ports().to_public_url(&input),
            format!(
                "http://localhost:24006/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?{PRESIGNED_QUERY}"
            )
        );
    }

    #[test]
    fn presigned_url_with_query_params_localhost() {
        let input = format!(
            "http://static-file-storage.localhost:4566/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?{PRESIGNED_QUERY}"
        );
        assert_eq!(
            default_ports().to_public_url(&input),
            format!(
                "http://localhost:4566/static-file-storage/file/a31e9af3-dd26-4531-b367-bfbbbac706cc?{PRESIGNED_QUERY}"
            )
        );
    }

    #[test]
    fn simple_virtual_host_url() {
        assert_eq!(
            default_ports().to_public_url("http://my-bucket.localstack:4566/some/path/to/file.txt"),
            "http://localhost:4566/my-bucket/some/path/to/file.txt"
        );
        assert_eq!(
            remapped_ports().to_public_url("http://my-bucket.localhost:4566/some/path/to/file.txt"),
            "http://localhost:24006/my-bucket/some/path/to/file.txt"
        );
    }

    #[test]
    fn root_path_and_no_path() {
        assert_eq!(
            default_ports().to_public_url("http://bucket.localstack:4566/"),
            "http://localhost:4566/bucket/"
        );
        assert_eq!(
            default_ports().to_public_url("http://bucket.localhost:4566"),
            "http://localhost:4566/bucket/"
        );
    }

    #[test]
    fn simple_query() {
        assert_eq!(
            default_ports().to_public_url("http://test-bucket.localstack:4566/key?versionId=123"),
            "http://localhost:4566/test-bucket/key?versionId=123"
        );
        assert_eq!(
            remapped_ports().to_public_url("http://test-bucket.localhost:4566/key?versionId=123"),
            "http://localhost:24006/test-bucket/key?versionId=123"
        );
    }

    #[test]
    fn missing_port_takes_the_public_port() {
        assert_eq!(
            default_ports().to_public_url("http://bucket.localstack/path/file.txt"),
            "http://localhost:4566/bucket/path/file.txt"
        );
        assert_eq!(
            remapped_ports().to_public_url("http://bucket.localhost/path/file.txt"),
            "http://localhost:24006/bucket/path/file.txt"
        );
    }

    /// A distribution-style URL from `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`
    /// carries the bucket in its path; only the origin moves to the mapped port.
    #[test]
    fn distribution_url_keeps_the_bucket_path() {
        assert_eq!(
            remapped_ports().to_public_url(
                "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1/v/2"
            ),
            "http://localhost:24006/doc-storage/macro%7Cteo%40macro.com/doc/1/v/2"
        );
    }

    #[test]
    fn is_idempotent_on_the_public_origin() {
        let public = "http://localhost:24006/doc-storage/key?versionId=1";
        assert_eq!(remapped_ports().to_public_url(public), public);
    }

    #[test]
    fn leaves_remote_url_untouched() {
        let input = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";
        assert_eq!(default_ports().to_public_url(input), input);
        assert_eq!(remapped_ports().to_public_url(input), input);
        let s3 = "https://my-bucket.s3.us-east-1.amazonaws.com/key?X-Amz-Signature=abc";
        assert_eq!(remapped_ports().to_public_url(s3), s3);
    }

    #[test]
    fn leaves_unparseable_input_untouched() {
        assert_eq!(remapped_ports().to_public_url("not a url"), "not a url");
    }
}

mod to_internal_url {
    use super::*;

    #[test]
    fn rewrites_localhost_to_the_internal_origin() {
        let input = "http://localhost:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";
        let expected = "http://localstack:4566/doc-storage/macro%7Cteo%40macro.com/doc/1";
        assert_eq!(default_ports().to_internal_url(input), expected);
        assert_eq!(remapped_ports().to_internal_url(input), expected);
    }

    #[test]
    fn rewrites_the_mapped_public_port_to_the_internal_port() {
        assert_eq!(
            remapped_ports()
                .to_internal_url("http://localhost:24006/doc-storage/key?versionId=123"),
            "http://localstack:4566/doc-storage/key?versionId=123"
        );
    }

    #[test]
    fn preserves_presigned_query_params() {
        let input =
            format!("http://localhost:24006/static-file-storage/file/abc?{PRESIGNED_QUERY}");
        assert_eq!(
            remapped_ports().to_internal_url(&input),
            format!("http://localstack:4566/static-file-storage/file/abc?{PRESIGNED_QUERY}")
        );
    }

    #[test]
    fn is_idempotent_on_the_internal_origin() {
        let input = "http://localstack:4566/doc-storage/key";
        assert_eq!(default_ports().to_internal_url(input), input);
        assert_eq!(remapped_ports().to_internal_url(input), input);
    }

    #[test]
    fn folds_virtual_host_buckets_into_the_path() {
        assert_eq!(
            remapped_ports().to_internal_url("http://doc-storage.localstack:4566/key"),
            "http://localstack:4566/doc-storage/key"
        );
    }

    /// A host process (seed CLI, e2e runner) has `LOCAL_AWS_URL` on localhost
    /// with the mapped port; server-side fetches must land there, not on the
    /// Docker alias.
    #[test]
    fn host_process_internal_endpoint_keeps_its_port() {
        let host_process =
            LocalAwsEndpoints::new("http://localhost:24006", "http://localhost:24006");
        assert_eq!(
            host_process.to_internal_url("http://localstack:4566/doc-storage/key"),
            "http://localhost:24006/doc-storage/key"
        );
        assert_eq!(
            host_process.to_public_url("http://localstack:4566/doc-storage/key"),
            "http://localhost:24006/doc-storage/key"
        );
    }

    #[test]
    fn leaves_remote_url_untouched() {
        let input = "https://d123.cloudfront.net/doc-storage/key?Signature=abc";
        assert_eq!(default_ports().to_internal_url(input), input);
        assert_eq!(remapped_ports().to_internal_url(input), input);
    }
}

mod endpoints {
    use super::*;

    #[test]
    fn only_the_origin_of_each_endpoint_is_used() {
        let endpoints = LocalAwsEndpoints::new(
            "http://localstack:4566/ignored?x=1",
            "http://localhost:24006/also-ignored",
        );
        assert_eq!(
            endpoints.to_public_url("http://localstack:4566/doc-storage/key"),
            "http://localhost:24006/doc-storage/key"
        );
        assert_eq!(
            endpoints.to_internal_url("http://localhost:24006/doc-storage/key"),
            "http://localstack:4566/doc-storage/key"
        );
    }

    #[test]
    fn a_non_loopback_public_host_is_recognised_on_both_sides() {
        let endpoints =
            LocalAwsEndpoints::new("http://localstack:4566", "http://192.168.1.20:24006");
        assert_eq!(
            endpoints.to_public_url("http://localstack:4566/doc-storage/key"),
            "http://192.168.1.20:24006/doc-storage/key"
        );
        assert_eq!(
            endpoints.to_internal_url("http://192.168.1.20:24006/doc-storage/key"),
            "http://localstack:4566/doc-storage/key"
        );
    }

    #[test]
    #[should_panic(expected = "LOCAL_AWS_PUBLIC_URL=nope is not a valid url")]
    fn a_malformed_endpoint_panics_with_its_name() {
        LocalAwsEndpoints::new("http://localstack:4566", "nope");
    }
}
