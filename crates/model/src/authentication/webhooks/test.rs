use serde_json::json;

use super::FusionAuthUserWebhook;

#[test]
fn user_create_payload_without_user_data_defaults_to_none() {
    let webhook = deserialize_user_create_payload(None);

    assert_eq!(webhook.event.user.data, None);
}

#[test]
fn user_create_payload_retains_user_data() {
    let data = json!({
        "custom": {
            "source": "test"
        },
        "arbitrary": ["metadata", 42]
    });

    let webhook = deserialize_user_create_payload(Some(data.clone()));

    assert_eq!(webhook.event.user.data, Some(data));
}

fn deserialize_user_create_payload(data: Option<serde_json::Value>) -> FusionAuthUserWebhook {
    let mut payload = json!({
        "event": {
            "createInstant": 1,
            "id": "event-id",
            "linkedObjectId": "linked-object-id",
            "info": {
                "ipAddress": "127.0.0.1"
            },
            "user": {
                "id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
                "email": "new.user@example.com",
                "username": null,
                "verified": true,
                "firstName": null,
                "lastName": null,
                "fullName": null
            },
            "type": "user.create"
        }
    });

    if let Some(data) = data {
        payload["event"]["user"]["data"] = data;
    }

    serde_json::from_value(payload).expect("valid FusionAuth user.create payload")
}
