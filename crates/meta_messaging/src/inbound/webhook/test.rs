use super::*;
use serde_json::json;

#[test]
fn instagram_post_share_preserves_title_and_native_preview_without_inventing_permalink() {
    let payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected shared post")
    };
    assert_eq!(
        message.content,
        "Have a look\n\nShared Instagram post · Preview\nA caption with <markup> & [links]"
    );
    assert_eq!(message.media.len(), 1);
    assert_eq!(
        message.media[0].id.as_ref().unwrap().as_str(),
        "18000000000000000"
    );
    assert!(!message.content.contains("https://"));
    assert_eq!(message.message_type, "ig_post");
}

#[test]
fn instagram_mixed_shares_keep_text_and_valid_attachments_when_one_part_is_missing() {
    let mut payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    let message = &mut payload["entry"][0]["messaging"][0]["message"];
    message["attachments"] = json!([
        {"type":"ig_post","payload":{"title":"Private or expired post"}},
        {"type":"image","payload":{}},
        {"type":"future_private_type","payload":{"secret":"must not be rendered"}},
        {"type":"image","payload":{"url":"https://scontent.cdninstagram.com/sanitized.jpg"}}
    ]);
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected message")
    };
    assert_eq!(message.media.len(), 1);
    assert_eq!(
        message.content,
        "Have a look\n\nShared Instagram post\nPrivate or expired post\n\nAttachment unavailable\n\nContent unavailable"
    );
    assert!(!message.content.contains("future_private_type"));
}

#[test]
fn instagram_share_titles_are_bounded_and_do_not_replace_customer_text() {
    let mut payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    payload["entry"][0]["messaging"][0]["message"]["attachments"][0]["payload"]["title"] =
        json!("🦀".repeat(3000));
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected message")
    };
    assert!(
        message
            .content
            .starts_with("Have a look\n\nShared Instagram post · Preview\n")
    );
    assert_eq!(message.content.matches('🦀').count(), 2000);
}

#[test]
fn instagram_reel_uses_only_the_supplied_public_permalink() {
    let mut payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    let a = &mut payload["entry"][0]["messaging"][0]["message"]["attachments"][0];
    a["type"] = json!("ig_reel");
    a["payload"] = json!({"url":"https://www.instagram.com/reel/Example_123/","title":"Reel title","reel_video_id":"18000000000000001"});
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected message")
    };
    assert_eq!(
        message.content,
        "Have a look\n\nShared Instagram reel\nReel title\n\nhttps://www.instagram.com/reel/Example_123/"
    );
    assert!(message.media.is_empty(), "a permalink is not a download");
    for url in [
        "https://www.instagram.com/direct/inbox/",
        "https://www.instagram.com.evil.test/reel/abc/",
        "https://www.instagram.com/reel/abc/?token=private",
        "https://lookaside.fbsbx.com/ig_messaging_cdn/private",
        "https://www.instagram.com/reel/abc/<script>",
    ] {
        assert!(instagram_permalink(url).is_none());
    }
}

#[test]
fn instagram_story_reply_keeps_customer_text_and_its_story_preview_together() {
    let mut payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    let m = &mut payload["entry"][0]["messaging"][0]["message"];
    m["attachments"] = json!([]);
    m["reply_to"] = json!({"story":{"id":"story1","url":"https://lookaside.fbsbx.com/ig_messaging_cdn/sanitized-story"}});
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected message")
    };
    assert!(
        message
            .content
            .starts_with("Have a look\n\nReply to Instagram story · Preview")
    );
    assert!(
        message.reply_to.is_none(),
        "story identity is not a provider message/thread ID"
    );
    assert_eq!(message.media[0].id.as_ref().unwrap().as_str(), "story1");
}

#[test]
fn revisions_are_not_customer_messages_and_deleted_payloads_never_download_media() {
    let mut payload: Value =
        serde_json::from_str(include_str!("fixtures/instagram_post.json")).unwrap();
    payload["entry"][0]["messaging"][0]["message"]["is_deleted"] = json!(true);
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    assert!(matches!(
        &events[0],
        IncomingEvent::Revision(IncomingRevision {
            change: MessageRevision::Deleted,
            ..
        })
    ));
    let event = &mut payload["entry"][0]["messaging"][0];
    event.as_object_mut().unwrap().remove("message");
    event["message_edit"] = json!({"mid":"shared-post-1","text":"An edit","num_edit":"2"});
    let events = decode(Provider::Instagram, &payload).unwrap().events;
    assert!(matches!(
        &events[0],
        IncomingEvent::Revision(IncomingRevision {
            change: MessageRevision::Edited { number: 2, .. },
            ..
        })
    ));
}

#[test]
fn whatsapp_structured_content_is_readable_and_reactions_do_not_open_conversations() {
    let cases = [
        (
            "location",
            json!({"name":"Example Park","address":"1 Example St","latitude":0,"longitude":"-73.5"}),
            "Shared location\nExample Park\n1 Example St\n0, -73.5",
        ),
        (
            "contacts",
            json!([{"name":{"formatted_name":"Example Person"},"phones":[{"phone":"+1 555 0100"}],"emails":[{"email":"person@example.test"}]}]),
            "Shared contact\nExample Person\n+1 555 0100\nperson@example.test",
        ),
        (
            "button",
            json!({"text":"No thanks","payload":"internal-campaign-key"}),
            "No thanks",
        ),
        (
            "interactive",
            json!({"type":"list_reply","list_reply":{"id":"opaque-id","title":"Tuesday","description":"Afternoon"}}),
            "Tuesday\nAfternoon",
        ),
        (
            "new_type",
            json!({"secret":"private"}),
            "Content unavailable",
        ),
    ];
    for (kind, value, expected) in cases {
        let mut m = json!({"from":"customer1","id":"m1","timestamp":"1791288000","type":kind});
        m[kind] = value;
        let events = decode(
            Provider::Whatsapp,
            &whatsapp_payload(
                "messages",
                json!({"metadata":{"phone_number_id":"phone1"},"messages":[m]}),
            ),
        )
        .unwrap()
        .events;
        let IncomingEvent::Message(message) = &events[0] else {
            panic!("expected message")
        };
        assert_eq!(message.content, expected);
    }
    let events=decode(Provider::Whatsapp,&whatsapp_payload("messages",json!({"metadata":{"phone_number_id":"phone1"},"messages":[{"type":"reaction","reaction":{"message_id":"original","emoji":""}}]}))).unwrap();
    assert!(matches!(&events.events[0],IncomingEvent::Unsupported {field,..} if field=="reaction"));
    assert_eq!(
        content::whatsapp_location(&json!({"latitude":"NaN","longitude":500})),
        "Shared location"
    );
}

#[test]
fn signature_covers_exact_bytes_and_product_must_match() {
    let body = br#"{"object":"instagram","entry":[]}"#;
    let mut mac = Hmac::<Sha256>::new_from_slice(b"test-only-secret").unwrap();
    mac.update(body);
    let digest = mac.finalize().into_bytes();
    let signature = format!(
        "sha256={}",
        digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    assert!(verify_signature(b"test-only-secret", &signature, body).is_ok());
    assert!(verify_signature(b"wrong-secret", &signature, body).is_err());
    assert!(verify_signature(b"test-only-secret", &signature, b"changed").is_err());
    assert!(verify_signature(b"test-only-secret", "", body).is_err());
    assert!(
        decode(
            Provider::Whatsapp,
            &serde_json::from_slice::<Value>(body).unwrap()
        )
        .is_err()
    );
}

fn whatsapp_payload(field: &str, value: Value) -> Value {
    json!({"object":"whatsapp_business_account","entry":[{"id":"waba1","changes":[{"field":field,"value":value}]}]})
}

#[test]
fn whatsapp_live_echo_and_history_have_distinct_provenance() {
    let message = json!({"from":"16505550100","to":"16505550101","id":"wamid.1","timestamp":"1791288000","type":"text","text":{"body":"Hello"}});
    for (field, key, provenance) in [
        ("messages", "messages", Provenance::Customer),
        (
            "smb_message_echoes",
            "message_echoes",
            Provenance::PhoneEcho,
        ),
        ("history", "messages", Provenance::OnboardingHistory),
    ] {
        let mut value = json!({"metadata":{"phone_number_id":"phone1"}});
        value[key] = json!([message]);
        let events = decode(Provider::Whatsapp, &whatsapp_payload(field, value))
            .unwrap()
            .events;
        let IncomingEvent::Message(message) = &events[0] else {
            panic!("expected message")
        };
        assert_eq!(message.provenance, provenance);
        assert_eq!(message.message_id.as_str(), "wamid.1");
        assert_eq!(
            message.direction,
            if field == "smb_message_echoes" {
                Direction::Outbound
            } else {
                Direction::Inbound
            }
        );
    }
}

#[test]
fn historical_threads_are_never_new_customer_messages() {
    let payload = whatsapp_payload(
        "history",
        json!({"metadata":{"phone_number_id":"phone1"},"history":[{"metadata":{"progress":75},"threads":[{"id":"customer1","messages":[{"id":"m1","from":"business1","timestamp":"1700000000","type":"media_placeholder"},{"id":"m2","from":"customer1","timestamp":"1700000001","type":"text","text":{"body":"past message"}}]}]}]}),
    );
    let events = decode(Provider::Whatsapp, &payload).unwrap().events;
    assert_eq!(events.len(), 3);
    for event in &events[..2] {
        let IncomingEvent::Message(message) = event else {
            panic!("expected message")
        };
        assert!(!message.provenance.is_new_customer_message());
    }
    let IncomingEvent::Message(message) = &events[0] else {
        panic!("expected message")
    };
    assert_eq!(message.direction, Direction::Outbound);
}

#[test]
fn instagram_uses_account_scoped_identity_and_preserves_media() {
    let payload = json!({"object":"instagram","entry":[{"id":"business1","messaging":[{"sender":{"id":"customer1"},"recipient":{"id":"business1"},"timestamp":1791288000123_i64,"message":{"mid":"m1","text":"Hello","attachments":[{"type":"image","payload":{"url":"https://scontent.cdninstagram.com/photo.jpg"}}]}}]}]});
    let result = decode(Provider::Instagram, &payload).unwrap().events;
    let IncomingEvent::Message(message) = &result[0] else {
        panic!("expected message")
    };
    assert_eq!(message.customer_id.as_str(), "customer1");
    assert_eq!(message.timestamp.timestamp_millis(), 1791288000123);
    assert_eq!(message.media.len(), 1);
    let mut bad = payload;
    bad["entry"][0]["id"] = json!("other-account");
    assert_eq!(decode(Provider::Instagram, &bad).unwrap().invalid_items, 1);
}

#[test]
fn malformed_timestamp_is_not_replaced_by_processing_time() {
    let payload = whatsapp_payload(
        "messages",
        json!({"metadata":{"phone_number_id":"phone1"},"messages":[{"from":"customer1","id":"m1","type":"text","text":{"body":"body"}}]}),
    );
    assert_eq!(
        decode(Provider::Whatsapp, &payload).unwrap().invalid_items,
        1
    );
}

#[test]
fn captionless_media_has_no_synthetic_text_but_captions_are_preserved() {
    for caption in [None, Some("A real caption"), Some("[image attachment]")] {
        let payload = whatsapp_payload(
            "messages",
            json!({
                "metadata":{"phone_number_id":"phone1"},
                "messages":[{"from":"customer1","id":"m1","timestamp":"1791288000",
                    "type":"image","image":{"id":"media1","caption":caption}}]
            }),
        );
        let events = decode(Provider::Whatsapp, &payload).unwrap().events;
        let IncomingEvent::Message(message) = &events[0] else {
            panic!("expected media")
        };
        assert_eq!(message.content, caption.unwrap_or_default());
        assert_eq!(message.media.len(), 1);
        let payload = json!({"object":"instagram","entry":[{"id":"business1","messaging":[{
            "sender":{"id":"customer1"},"recipient":{"id":"business1"},"timestamp":1791288000123_i64,
            "message":{"mid":"m1","text":caption,"attachments":[{"type":"image","payload":{"url":"https://scontent.cdninstagram.com/photo.jpg"}}]}
        }]}]});
        let events = decode(Provider::Instagram, &payload).unwrap().events;
        let IncomingEvent::Message(message) = &events[0] else {
            panic!("expected media")
        };
        assert_eq!(message.content, caption.unwrap_or_default());
        assert_eq!(message.media.len(), 1);
    }
}

#[test]
fn every_valid_item_in_a_size_bounded_history_chunk_is_preserved() {
    let messages:Vec<_>=(0..21_000).map(|i|json!({"id":format!("old-{i}"),"from":"customer","timestamp":"1700000000","type":"text","text":{"body":"old"}})).collect();
    let payload = whatsapp_payload(
        "history",
        json!({"metadata":{"phone_number_id":"phone"},"history":[{"metadata":{"progress":100},"threads":[{"id":"customer","messages":messages}]}]}),
    );
    let events = decode(Provider::Whatsapp, &payload).unwrap().events;
    assert_eq!(events.len(), 21_001);
    assert!(matches!(
        events.last(),
        Some(IncomingEvent::HistoryProgress {
            progress: Some(100),
            ..
        })
    ));
}

#[test]
fn malformed_history_item_preserves_messages_threads_and_progress() {
    let good = |id: &str| json!({"id":id,"from":"customer","timestamp":"1700000000","type":"text","text":{"body":"retained"}});
    let payload = whatsapp_payload(
        "history",
        json!({
            "metadata":{"phone_number_id":"phone"},
            "history":[{"metadata":{"progress":75},"threads":[
                {"id":"customer","messages":[good("before"),{"type":"text"},good("after")]},
                {"messages":[good("bad-thread")]},
                {"id":"customer","messages":[good("next-thread")]}
            ]}]
        }),
    );
    let decoded = decode(Provider::Whatsapp, &payload).unwrap();
    assert_eq!(decoded.invalid_items, 2);
    let ids: Vec<_> = decoded
        .events
        .iter()
        .filter_map(|event| match event {
            IncomingEvent::Message(message) => Some(message.message_id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(ids, ["before", "after", "next-thread"]);
    assert!(matches!(
        decoded.events.last(),
        Some(IncomingEvent::HistoryProgress {
            progress: Some(75),
            ..
        })
    ));
}

#[test]
fn malformed_instagram_item_or_entry_does_not_hide_healthy_accounts() {
    let event = |id: &str| json!({"sender":{"id":"customer"},"recipient":{"id":"business"},"timestamp":1700000000000_i64,"message":{"mid":id,"text":"retained"}});
    let payload = json!({"object":"instagram","entry":[
        {"id":"business","messaging":[event("before"),{"message":{"mid":"bad"}},event("after")]},
        {"messaging":[event("invalid-account")]},
        {"id":"business","messaging":[event("next-entry")]}
    ]});
    let decoded = decode(Provider::Instagram, &payload).unwrap();
    assert_eq!(decoded.invalid_items, 2);
    assert_eq!(decoded.events.len(), 3);
}

#[test]
fn malformed_collection_does_not_hide_a_valid_status() {
    let payload = whatsapp_payload(
        "messages",
        json!({"metadata":{"phone_number_id":"phone"},
        "messages": false, "statuses":[{"id":"status-id","status":"read","timestamp":"1700000000"}]}),
    );
    let decoded = decode(Provider::Whatsapp, &payload).unwrap();
    assert_eq!(decoded.invalid_items, 1);
    assert!(matches!(
        decoded.events.as_slice(),
        [IncomingEvent::Status {
            state: DeliveryState::Read,
            ..
        }]
    ));
}
