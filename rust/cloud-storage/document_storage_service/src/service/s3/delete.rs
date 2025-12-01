use aws_sdk_s3 as s3;
use s3::types::{Delete, ObjectIdentifier};
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

/// Deletes all document instances stored under a user's document
#[instrument(skip(client))]
pub(in crate::service::s3) async fn delete_document(
    client: &s3::Client,
    bucket: &str,
    user_id: &str,
    document_id: &str,
) -> anyhow::Result<()> {
    if cfg!(feature = "local") {
        return Ok(());
    }

    let mut to_delete: Vec<String> = Vec::new();

    let prefix = format!("{}/{}", user_id, document_id);
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

#[cfg(test)]
mod tests {
    use mockall::predicate::eq;

    use crate::service::s3::S3;

    #[tokio::test]
    async fn test_delete_document() {
        let mut mock = S3::default();
        mock.expect_delete_document()
            .with(eq("user_id"), eq("document_id"))
            .return_once(|_, _| Ok(()));

        let result = mock.delete_document(&"user_id", &"document_id").await;

        assert_eq!(result.is_ok(), true);
    }
}
