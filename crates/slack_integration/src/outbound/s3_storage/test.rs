use super::*;
use crate::outbound::test_support::mock_http;
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use futures::{StreamExt, TryStreamExt};

const KEY: &str = "slack-import/01980000-0000-7000-8000-000000000001/01980000-0000-7000-8000-000000000002/users.json";

fn upload(bytes: &[u8]) -> RegisteredUpload {
    RegisteredUpload {
        key: KEY.parse().unwrap(),
        descriptor: UploadDescriptor {
            upload: UploadId::Users,
            sha256: format!("{:x}", Sha256::digest(bytes)).parse().unwrap(),
            byte_length: bytes.len() as u64,
            record_count: None,
        },
    }
}

fn storage(endpoint: &str) -> S3ImportStorage {
    let config = aws_sdk_s3::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(endpoint)
        .force_path_style(true)
        .retry_config(RetryConfig::disabled())
        .build();
    S3ImportStorage::new(
        Client::from_conf(config),
        "staging".into(),
        ImportLimits::default(),
    )
    .unwrap()
}

fn response(upload: &RegisteredUpload, version: Option<&str>, body: &str) -> String {
    let version = version
        .map(|v| format!("x-amz-version-id: {v}\r\n"))
        .unwrap_or_default();
    format!(
        "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\nContent-Type: application/json\r\nx-amz-checksum-sha256: {}\r\nETag: \"original\"\r\n{version}\r\n{body}",
        upload.descriptor.byte_length,
        checksum(&upload.descriptor.sha256)
    )
}

#[tokio::test]
async fn grants_sign_create_only_checksum_length_type_and_short_expiry() {
    let storage = storage("http://localhost:9000");
    let upload = upload(b"[]");
    let before = Utc::now();
    let grant = storage.grant(&upload).await.unwrap();
    assert_eq!(
        grant
            .required_headers
            .get("if-none-match")
            .map(String::as_str),
        Some("*")
    );
    assert_eq!(
        grant
            .required_headers
            .get("content-type")
            .map(String::as_str),
        Some("application/json")
    );
    assert_eq!(
        grant.required_headers.get("x-amz-checksum-sha256"),
        Some(&checksum(&upload.descriptor.sha256))
    );
    assert!(!grant.required_headers.contains_key("content-length"));
    assert!(grant.url.contains("X-Amz-Expires=300"));
    let signed_headers = grant
        .url
        .split("X-Amz-SignedHeaders=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap();
    for header in [
        "content-length",
        "content-type",
        "if-none-match",
        "x-amz-checksum-sha256",
    ] {
        assert!(
            signed_headers.contains(header),
            "unsigned {header}: {signed_headers}"
        );
    }
    assert!(grant.expires_at >= before + chrono::Duration::seconds(300));
    assert!(grant.expires_at <= Utc::now() + chrono::Duration::seconds(300));
    // Retrying never replaces create-only with overwrite permission.
    assert_eq!(
        storage.grant(&upload).await.unwrap().required_headers,
        grant.required_headers
    );
}

#[tokio::test]
async fn conversation_grant_binds_exact_part_and_ndjson_content_type() {
    let mut upload = upload(b"{}\n");
    upload.key = KEY.replace("users.json", "C123/4.ndjson").parse().unwrap();
    upload.descriptor.upload = UploadId::ConversationPart {
        slack_channel_id: "C123".parse().unwrap(),
        part_index: 4,
    };
    upload.descriptor.record_count = Some(1);
    let storage = storage("http://localhost:9000");
    let grant = storage.grant(&upload).await.unwrap();
    assert!(grant.url.contains("/C123/4.ndjson?"));
    assert_eq!(
        grant.required_headers["content-type"],
        "application/x-ndjson"
    );
    for suffix in ["C123/3.ndjson", "G123/4.ndjson", "users.json"] {
        upload.key = KEY.replace("users.json", suffix).parse().unwrap();
        assert!(storage.grant(&upload).await.is_err());
    }
}

#[tokio::test]
async fn rejects_altered_keys_and_oversized_descriptors_before_io() {
    let storage = storage("http://127.0.0.1:1");
    let mut upload = upload(b"[]");
    for suffix in ["C123/0.ndjson", "users.json/extra", "C123/00.ndjson"] {
        upload.key = KEY.replace("users.json", suffix).parse().unwrap();
        assert!(storage.grant(&upload).await.is_err());
        assert!(storage.verify(&upload).await.is_err());
    }
    upload.key = KEY.parse().unwrap();
    upload.descriptor.byte_length = u64::MAX;
    assert!(storage.grant(&upload).await.is_err());
}

#[tokio::test]
async fn head_verifies_checksum_size_type_and_pins_identity() {
    let upload = upload(b"[]");
    for (version, expected) in [
        (Some("v1"), ObjectIdentity::Version("v1".parse().unwrap())),
        (
            None,
            ObjectIdentity::EntityTag("\"original\"".parse().unwrap()),
        ),
        (
            Some("null"),
            ObjectIdentity::EntityTag("\"original\"".parse().unwrap()),
        ),
    ] {
        let (endpoint, requests) = mock_http(vec![response(&upload, version, "")]);
        assert_eq!(
            storage(&endpoint).verify(&upload).await.unwrap().identity,
            expected
        );
        let request = requests.recv().unwrap().to_lowercase();
        assert!(request.starts_with("head /staging/slack-import/"));
        assert!(request.contains("x-amz-checksum-mode: enabled"));
    }
    let valid = response(&upload, None, "");
    for invalid in [
        valid.replace("Content-Length: 2", "Content-Length: 3"),
        valid.replace(
            &checksum(&upload.descriptor.sha256),
            &STANDARD.encode([0u8; 32]),
        ),
        valid.replace("application/json", "text/plain"),
        valid.replace(
            &format!(
                "x-amz-checksum-sha256: {}\r\n",
                checksum(&upload.descriptor.sha256)
            ),
            "",
        ),
        valid.replace("ETag: \"original\"\r\n", ""),
    ] {
        let (endpoint, _) = mock_http(vec![invalid]);
        assert!(storage(&endpoint).verify(&upload).await.is_err());
    }
}

#[tokio::test]
async fn get_enforces_version_or_etag_and_streams_verified_bytes() {
    let registered = upload(b"[]");
    for identity in [
        ObjectIdentity::Version("v1".parse().unwrap()),
        ObjectIdentity::EntityTag("\"original\"".parse().unwrap()),
    ] {
        let (endpoint, requests) = mock_http(vec![response(&registered, Some("v1"), "[]")]);
        let upload = VerifiedUpload {
            registered: registered.clone(),
            identity: identity.clone(),
        };
        let chunks: Vec<_> = storage(&endpoint)
            .read(&upload)
            .await
            .unwrap()
            .try_collect()
            .await
            .unwrap();
        assert_eq!(chunks.concat(), b"[]");
        let request = requests.recv().unwrap().to_lowercase();
        match identity {
            ObjectIdentity::Version(_) => assert!(request.contains("versionid=v1")),
            ObjectIdentity::EntityTag(_) => assert!(request.contains("if-match: \"original\"")),
        }
    }
}

#[tokio::test]
async fn overwritten_or_unpinned_objects_are_rejected() {
    let registered = upload(b"[]");
    let upload = VerifiedUpload {
        registered: registered.clone(),
        identity: ObjectIdentity::EntityTag("\"original\"".parse().unwrap()),
    };
    let precondition =
        "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .to_owned();
    for response in [
        precondition,
        response(&registered, None, "[]").replace("ETag: \"original\"", "ETag: \"changed\""),
    ] {
        let (endpoint, _) = mock_http(vec![response]);
        assert!(storage(&endpoint).read(&upload).await.is_err());
    }
    let invalid_version = VerifiedUpload {
        identity: ObjectIdentity::Version("null".parse().unwrap()),
        ..upload
    };
    assert!(
        storage("http://127.0.0.1:1")
            .read(&invalid_version)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn get_revalidates_metadata_and_never_accepts_corrupt_body() {
    let registered = upload(b"[]");
    let upload = VerifiedUpload {
        registered: registered.clone(),
        identity: ObjectIdentity::Version("v1".parse().unwrap()),
    };
    let valid = response(&registered, Some("v1"), "[]");
    for invalid in [
        valid.replace("Content-Length: 2", "Content-Length: 3"),
        valid.replace(
            &checksum(&registered.descriptor.sha256),
            &STANDARD.encode([0u8; 32]),
        ),
        valid.replace("x-amz-version-id: v1", "x-amz-version-id: v2"),
    ] {
        let (endpoint, _) = mock_http(vec![invalid]);
        assert!(storage(&endpoint).read(&upload).await.is_err());
    }
    for body in ["{}", "["] {
        let (endpoint, _) = mock_http(vec![response(&registered, Some("v1"), body)]);
        let stream = storage(&endpoint).read(&upload).await.unwrap();
        assert!(stream.try_collect::<Vec<_>>().await.is_err());
    }
}

#[tokio::test]
async fn stream_checks_actual_bytes_digest_and_chunk_bound_independently_of_metadata() {
    use aws_sdk_s3::primitives::ByteStream as AwsStream;
    let data = vec![b'x'; READ_CHUNK_BYTES * 3 + 5];
    let descriptor = upload(&data).descriptor;
    let chunks: Vec<_> = bounded_stream(AwsStream::from(data.clone()), &descriptor)
        .try_collect()
        .await
        .unwrap();
    assert!(chunks.iter().all(|chunk| chunk.len() <= READ_CHUNK_BYTES));
    assert_eq!(chunks.concat(), data);
    for invalid in [
        vec![b'x'; data.len() + 1],
        vec![b'x'; data.len() - 1],
        vec![b'y'; data.len()],
    ] {
        let mut stream = bounded_stream(AwsStream::from(invalid), &descriptor);
        let mut delivered = 0;
        loop {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    delivered += chunk.len();
                    assert!(delivered <= data.len());
                }
                Some(Err(_)) => break,
                None => panic!("invalid stream accepted"),
            }
        }
    }
}
