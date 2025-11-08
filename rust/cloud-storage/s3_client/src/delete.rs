use anyhow::Context;
use aws_sdk_s3 as s3;
use s3::types::{Delete, ObjectIdentifier};

/// Deletes a given item from the bucket
#[tracing::instrument(skip(client))]
pub async fn delete(client: &s3::Client, bucket: &str, key: &str) -> anyhow::Result<()> {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .context(format!("could not get item {key} from bucket {bucket}"))?;

    Ok(())
}

/// Deletes all items under a given folder
/// This assumes there are no sub-folders under the given folder
#[tracing::instrument(skip(client))]
pub(crate) async fn delete_folder(
    client: &s3::Client,
    bucket: &str,
    folder: &str,
) -> anyhow::Result<()> {
    let mut to_delete: Vec<String> = Vec::new();

    let resp = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(folder)
        .send()
        .await?;
    tracing::trace!("got objects");

    for object in resp.contents() {
        if let Some(key) = object.key() {
            to_delete.push(key.to_string());
        }
    }

    if !to_delete.is_empty() {
        for chunk in to_delete.chunks(1000) {
            tracing::trace!("deleting chunk");
            delete_objects(client, bucket, chunk.to_vec()).await?;
        }
    }
    Ok(())
}

/// Deletes a given list of items from the bucket
#[tracing::instrument(skip(client))]
async fn delete_objects(
    client: &s3::Client,
    bucket: &str,
    objects: Vec<String>,
) -> anyhow::Result<()> {
    let mut delete_objects: Vec<ObjectIdentifier> = vec![];

    for obj in objects {
        let obj_id = ObjectIdentifier::builder()
            .set_key(Some(obj))
            .build()
            .context("building ObjectIdentifier")?;
        delete_objects.push(obj_id);
    }

    let delete = Delete::builder()
        .set_objects(Some(delete_objects))
        .build()
        .context("building Delete")?;

    client
        .delete_objects()
        .bucket(bucket)
        .delete(delete)
        .send()
        .await?;

    Ok(())
}
