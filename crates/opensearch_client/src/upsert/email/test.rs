use super::*;

fn args_with_addresses() -> UpsertEmailArgs {
    UpsertEmailArgs {
        thread_id: "thread-1".to_string(),
        message_id: "message-1".to_string(),
        sender: "dana@corp.example".to_string(),
        sender_name: Some("Dana".to_string()),
        reply_to: Some("Riley@LawFirm.example".to_string()),
        recipients: vec!["jane.doe@partner.example".to_string()],
        recipient_names: vec!["Jane Doe".to_string()],
        cc: vec!["x@mail.lawfirm.example".to_string()],
        cc_names: vec![],
        bcc: vec!["sam+test@mailbox.example".to_string()],
        bcc_names: vec![],
        labels: vec!["INBOX".to_string()],
        link_id: "link-1".to_string(),
        user_id: "macro|dana@corp.example".to_string(),
        updated_at_seconds: EpochSeconds::new(1_752_500_000).unwrap(),
        updated_at_millis: EpochMillis::new(1_752_500_000_000).unwrap(),
        subject: Some("subject".to_string()),
        sent_at_seconds: None,
        sent_at_millis: None,
        content: "body".to_string(),
        properties: vec![],
    }
}

#[test]
fn address_search_fields_extracts_domains_and_local_parts() {
    let (domains, local_parts) =
        address_search_fields(["riley@lawfirm.example", "dana@corp.example"]);
    assert_eq!(domains, vec!["corp.example", "lawfirm.example"]);
    assert_eq!(local_parts, vec!["dana", "riley"]);
}

#[test]
fn address_search_fields_expands_subdomain_suffixes() {
    let (domains, _) = address_search_fields(["x@mail.lawfirm.example"]);
    assert_eq!(domains, vec!["lawfirm.example", "mail.lawfirm.example"]);
}

#[test]
fn address_search_fields_splits_local_part_segments() {
    let (_, local_parts) =
        address_search_fields(["jane.doe@partner.example", "sam+test@mailbox.example"]);
    assert_eq!(
        local_parts,
        vec!["doe", "jane", "jane.doe", "sam", "sam+test", "test"]
    );
}

#[test]
fn address_search_fields_lowercases() {
    let (domains, local_parts) = address_search_fields(["Riley@LawFirm.Example"]);
    assert_eq!(domains, vec!["lawfirm.example"]);
    assert_eq!(local_parts, vec!["riley"]);
}

#[test]
fn address_search_fields_skips_malformed_addresses() {
    let (domains, local_parts) =
        address_search_fields(["not-an-address", "@no-local", "no-domain@", ""]);
    assert!(domains.is_empty());
    assert!(local_parts.is_empty());
}

#[test]
fn address_search_fields_single_label_domain() {
    let (domains, _) = address_search_fields(["root@localhost"]);
    assert_eq!(domains, vec!["localhost"]);
}

#[test]
fn to_index_document_injects_derived_fields() -> anyhow::Result<()> {
    let doc = to_index_document(&args_with_addresses())?;
    assert_eq!(
        doc["domains"],
        serde_json::json!([
            "corp.example",
            "lawfirm.example",
            "mail.lawfirm.example",
            "mailbox.example",
            "partner.example"
        ])
    );
    assert_eq!(
        doc["local_parts"],
        serde_json::json!([
            "dana", "doe", "jane", "jane.doe", "riley", "sam", "sam+test", "test", "x"
        ])
    );
    assert_eq!(doc["sender"], "dana@corp.example");
    assert_eq!(doc["entity_id"], "thread-1");
    Ok(())
}
