//! BackfillContactsUsersSet: canonicalize only contacts-queue node membership.

use serde_json::{Map, Value};

pub(super) fn users_set(section: &str, fields: &mut Map<String, Value>) {
    let contacts = |queue: Option<&Value>| {
        queue
            .and_then(Value::as_str)
            .is_some_and(|queue| queue.ends_with("/000000000000/contacts"))
    };
    if section == "outcome" && contacts(fields.get("queue")) {
        if let Some(Value::String(body)) = fields.get_mut("body")
            && let Ok(mut payload) = serde_json::from_str::<Value>(body)
            && sort_users(&mut payload)
        {
            *body = serde_json::to_string(&payload).expect("contacts body");
        }
    } else if section == "sqs"
        && fields.get("operation").and_then(Value::as_str) == Some("SendMessage")
        && let Some(request) = fields.get_mut("request").and_then(Value::as_object_mut)
        && contacts(request.get("QueueUrl"))
        && let Some(body) = request.get_mut("MessageBody")
    {
        sort_users(body);
    }
}

fn sort_users(payload: &mut Value) -> bool {
    let Some(users) = payload.get_mut("users").and_then(Value::as_array_mut) else {
        return false;
    };
    if !users.iter().all(Value::is_string) {
        return false;
    }
    users.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    true
}
