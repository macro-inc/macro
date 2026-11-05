use aws_sdk_s3 as s3;
use model_owner::Owner;
use s3::types::{Delete, ObjectIdentifier};
use s3_key::{build_artifact_document_prefix, build_cloud_storage_bucket_document_prefix};
use tracing::instrument;

#[instrument(skip(client))]
pub(in crate::service::s3) async fn delete_objects(
    client: &s3::Client,
    bucket: &str,
    objects: Vec<String>,
) -> anyhow::Result<()> {
    if cfg!(feature = "local") {
        return Ok(());
    }

    let mut delete_objects: Vec<ObjectIdentifier> = vec![];

    for obj in objects {
        let obj_id = ObjectIdentifier::builder()
            .set_key(Some(obj))
            .build()
            .expect("building ObjectIdentifier");
        delete_objects.push(obj_id);
    }

    let delete = Delete::builder()
        .set_objects(Some(delete_objects))
        .build()
        .expect("building Delete");

    client
        .delete_objects()
        .bucket(bucket)
        .delete(delete)
        .send()
        .await?;

    Ok(())
}

/// Deletes all document instances stored under an owner's document
#[instrument(skip(client))]
pub(in crate::service::s3) async fn delete_document(
    client: &s3::Client,
    bucket: &str,
    owner: &Owner,
    document_id: &str,
) -> anyhow::Result<()> {
    if cfg!(feature = "local") {
        return Ok(());
    }

    let mut to_delete: Vec<String> = Vec::new();

    let prefix = build_cloud_storage_bucket_document_prefix(owner, document_id);
    let resp = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(prefix)
        .send()
        .await?;

    for object in resp.contents() {
        if let Some(key) = object.key() {
            to_delete.push(key.to_string());
        }
    }

    if !to_delete.is_empty() {
        delete_objects(client, bucket, to_delete).await?;
    }
    Ok(())
}

/// Deletes every object of an artifact document: the files of all its
/// versions and anything uploaded for it. Empty for other documents.
#[instrument(skip(client))]
pub(in crate::service::s3) async fn delete_artifact_objects(
    client: &s3::Client,
    bucket: &str,
    document_id: &str,
) -> anyhow::Result<()> {
    if cfg!(feature = "local") {
        return Ok(());
    }

    let mut pages = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(build_artifact_document_prefix(document_id))
        .into_paginator()
        .send();
    while let Some(page) = pages.next().await {
        let keys: Vec<String> = page?
            .contents()
            .iter()
            .filter_map(|object| object.key().map(str::to_string))
            .collect();
        // A list page holds at most 1000 keys, the most one delete accepts.
        if !keys.is_empty() {
            delete_objects(client, bucket, keys).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use mockall::predicate::eq;
    use model_owner::Owner;

    use crate::service::s3::S3;

    #[tokio::test]
    async fn test_delete_document() {
        let owner = Owner::from_principal_str("macro|user@example.com").unwrap();
        let mut mock = S3::default();
        mock.expect_delete_document()
            .with(eq(owner.clone()), eq("document_id"))
            .return_once(|_, _| Ok(()));

        let result = mock.delete_document(&owner, "document_id").await;

        assert!(result.is_ok());
    }
}
