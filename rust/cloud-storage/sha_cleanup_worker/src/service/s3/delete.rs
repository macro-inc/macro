use aws_sdk_s3 as s3;
use s3::types::{Delete, ObjectIdentifier};
use tracing::instrument;

#[instrument(skip(client, bucket, objects))]
pub(in crate::service::s3) async fn delete_objects(
    client: &s3::Client,
    bucket: &str,
    objects: Vec<String>,
) -> Result<(), anyhow::Error> {
    if cfg!(feature = "local") {
        return Ok(());
    }
    const MAX_DELETE_OBJECTS: usize = 1000;

    for chunk in objects.chunks(MAX_DELETE_OBJECTS) {
        let delete_objects: Vec<ObjectIdentifier> = chunk
            .iter()
            .map(|obj| {
                ObjectIdentifier::builder()
                    .set_key(Some(obj.clone()))
                    .build()
                    .expect("building ObjectIdentifier")
            })
            .collect();

        let delete = Delete::builder()
            .set_objects(Some(delete_objects))
            .build()
            .expect("building Delete");

        client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("unable to delete objects");
                anyhow::Error::from(e)
            })?;
    }

    Ok(())
}

#[instrument(skip(client, bucket))]
pub(in crate::service::s3) async fn delete_object(
    client: &s3::Client,
    bucket: &str,
    key: &str,
) -> Result<(), anyhow::Error> {
    if cfg!(feature = "local") {
        return Ok(());
    }

    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await?;

    Ok(())
}
