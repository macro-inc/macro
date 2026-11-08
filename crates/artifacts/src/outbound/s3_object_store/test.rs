use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};

use super::*;

const SHA256: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

fn store() -> S3ArtifactObjectStore {
    S3ArtifactObjectStore::new(
        aws_sdk_s3::Client::from_conf(
            aws_sdk_s3::Config::builder()
                .behavior_version(BehaviorVersion::latest())
                .region(Region::new("us-east-1"))
                .credentials_provider(Credentials::new("test", "test", None, None, "test"))
                .build(),
        ),
        "artifact-test-bucket",
    )
}

/// S3 rejects a presigned PUT whose signed headers differ, so the declared
/// size, type and digest all have to be signed.
#[tokio::test]
async fn a_presigned_upload_signs_its_length_type_and_checksum() {
    let upload = store()
        .presign_put(
            "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f",
            &crate::domain::manifest::parse_sha256(SHA256).unwrap(),
            5,
            "text/html",
        )
        .await
        .unwrap();

    let signed_headers = upload
        .url
        .split(['?', '&'])
        .find_map(|pair| pair.strip_prefix("X-Amz-SignedHeaders="))
        .map(|value| urlencoding::decode(value).unwrap().into_owned())
        .unwrap();
    let signed: Vec<&str> = signed_headers.split(';').collect();
    for header in ["content-length", "content-type", "x-amz-checksum-sha256"] {
        assert!(
            signed.contains(&header),
            "{header} unsigned: {signed_headers}"
        );
    }
}
