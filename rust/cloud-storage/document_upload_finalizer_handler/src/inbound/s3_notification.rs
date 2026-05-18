use serde::Deserialize;

use crate::app::ObjectCreated;

/// Parse S3 event-notification JSON into normalized object-created events.
pub fn object_created_events_from_body(
    body: &str,
) -> Result<Vec<ObjectCreated>, serde_json::Error> {
    let event = serde_json::from_str::<S3EventNotification>(body)?;

    Ok(event
        .records
        .into_iter()
        .filter(|record| is_object_created_event(&record.event_name))
        .map(|record| ObjectCreated {
            bucket: record.s3.bucket.name,
            key: decode_s3_event_key(&record.s3.object.key),
        })
        .collect())
}

fn is_object_created_event(event_name: &str) -> bool {
    event_name.starts_with("ObjectCreated:") || event_name.starts_with("s3:ObjectCreated:")
}

fn decode_s3_event_key(key: &str) -> String {
    let form_encoded = key.replace('+', " ");
    urlencoding::decode(&form_encoded)
        .map(|decoded| decoded.into_owned())
        .unwrap_or_else(|error| {
            tracing::warn!(%key, error=?error, "failed to URL-decode S3 event key; using raw key");
            key.to_string()
        })
}

#[derive(Deserialize)]
struct S3EventNotification {
    #[serde(rename = "Records")]
    records: Vec<S3EventRecord>,
}

#[derive(Deserialize)]
struct S3EventRecord {
    #[serde(rename = "eventName")]
    event_name: String,
    s3: S3Entity,
}

#[derive(Deserialize)]
struct S3Entity {
    bucket: S3Bucket,
    object: S3Object,
}

#[derive(Deserialize)]
struct S3Bucket {
    name: String,
}

#[derive(Deserialize)]
struct S3Object {
    key: String,
}
