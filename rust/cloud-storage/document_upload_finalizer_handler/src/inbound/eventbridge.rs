use aws_lambda_events::event::eventbridge::EventBridgeEvent;

use crate::app::ObjectCreated;

/// Convert an EventBridge S3 object-created payload to the domain event.
pub fn object_created_from_event(event: &EventBridgeEvent) -> Option<ObjectCreated> {
    let detail = &event.detail;

    let bucket = detail
        .get("bucket")
        .and_then(|bucket| bucket.get("name"))
        .and_then(|name| name.as_str())?;
    let key = detail
        .get("object")
        .and_then(|object| object.get("key"))
        .and_then(|key| key.as_str())?;

    Some(ObjectCreated {
        bucket: bucket.to_string(),
        key: key.to_string(),
    })
}
