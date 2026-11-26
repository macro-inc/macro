use super::*;

#[test]
fn a_change_notification_names_its_message_and_a_lifecycle_event_does_not() {
    // The shapes Graph posts for a `me/messages` subscription.
    let body = br##"{"value":[
        {"subscriptionId":"sub","clientState":"secret","changeType":"created",
         "resource":"Users/user-1/Messages/AAkALgAAAA==",
         "resourceData":{"@odata.type":"#Microsoft.Graph.Message","@odata.id":"Users/user-1/Messages/AAkALgAAAA==","id":"AAkALgAAAA=="},
         "tenantId":"tenant"},
        {"subscriptionId":"sub","clientState":"secret","lifecycleEvent":"missed"}
    ]}"##;

    let batch = serde_json::from_slice::<Batch>(body).unwrap();

    let [changed, missed] = batch.value.as_slice() else {
        panic!("expected two notifications");
    };
    assert_eq!(
        changed.message().as_ref().map(ProviderId::as_str),
        Some("AAkALgAAAA==")
    );
    assert!(missed.message().is_none());
}
