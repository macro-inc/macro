use super::*;

#[test]
fn check_ser_meta() -> Result<(), Box<dyn std::error::Error>> {
    let m = MentionedInDocumentCommentMetadata {
        document_name: "test".to_string(),
        owner: MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
        file_type: None,
        mention_id: "xxx".to_string(),
        thread_id: 42,
        comment_id: 99,
        text: "yy".to_string(),
        sender_profile_picture_url: None,
    };
    let res = serde_json::to_string(&m).unwrap();
    assert!(res.contains(r#"mentionId":"xxx""#));
    assert!(res.contains(r#"threadId":42"#));
    assert!(res.contains(r#"commentId":99"#));
    Ok(())
}

fn user_id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

// ---------------------------------------------------------------------------
// No duplicate notifications
// ---------------------------------------------------------------------------

#[test]
fn mentioned_user_who_is_also_thread_participant_gets_only_mention() {
    let sender = user_id("macro|sender@test.com");
    let bob = "macro|bob@test.com";

    let result = compute_notification_recipients(
        Some(&sender),
        &[bob.to_string()],                              // bob is mentioned
        &[bob.to_string(), sender.as_ref().to_string()], // bob is also a thread participant
        &user_id("macro|owner@test.com"),
        true, // is_reply
    );

    assert!(
        result.mention_recipients.contains(&user_id(bob)),
        "bob should be in mention recipients"
    );
    assert!(
        !result.thread_reply_recipients.contains(&user_id(bob)),
        "bob should NOT be in thread reply recipients"
    );
    assert_eq!(
        result.all_recipients().len(),
        result.total_count(),
        "no user should appear in more than one recipient set"
    );
}

#[test]
fn mentioned_user_who_is_also_doc_owner_gets_only_mention() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[owner.as_ref().to_string()], // owner is mentioned
        &[sender.as_ref().to_string()],
        &owner,
        false,
    );

    assert!(
        result.mention_recipients.contains(&owner),
        "owner should be in mention recipients"
    );
    assert!(
        result.doc_owner_recipient.is_none(),
        "owner should NOT get a separate doc owner notification"
    );
}

#[test]
fn thread_participant_who_is_also_doc_owner_gets_only_thread_reply() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[],                                                        // no mentions
        &[owner.as_ref().to_string(), sender.as_ref().to_string()], // owner is thread participant
        &owner,
        true,
    );

    assert!(
        result.thread_reply_recipients.contains(&owner),
        "owner should be in thread reply recipients"
    );
    assert!(
        result.doc_owner_recipient.is_none(),
        "owner should NOT also get a doc owner notification"
    );
}

#[test]
fn user_who_is_mentioned_and_thread_participant_and_doc_owner_gets_only_mention() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[owner.as_ref().to_string()], // owner is mentioned
        &[owner.as_ref().to_string(), sender.as_ref().to_string()], // owner is thread participant
        &owner,                        // and doc owner
        true,
    );

    assert!(result.mention_recipients.contains(&owner),);
    assert!(!result.thread_reply_recipients.contains(&owner));
    assert!(result.doc_owner_recipient.is_none());
    assert_eq!(result.all_recipients().len(), result.total_count());
}

// ---------------------------------------------------------------------------
// Case-insensitive dedup: mention IDs may have different casing than owner IDs
// ---------------------------------------------------------------------------

#[test]
fn dedup_works_across_different_casing() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|bob@test.com");

    // Mention comes in with mixed case, comment owner stored lowercase
    let result = compute_notification_recipients(
        Some(&sender),
        &["macro|Bob@Test.COM".to_string()], // mixed case mention
        &[
            "macro|bob@test.com".to_string(),
            sender.as_ref().to_string(),
        ], // lowercase owner
        &owner,
        true,
    );

    // Bob should appear exactly once across all recipient sets
    let all = result.all_recipients();
    let bob_count = all.iter().filter(|r| r.contains("bob")).count();
    assert_eq!(
        bob_count, 1,
        "bob should receive exactly one notification, got {bob_count}"
    );
    assert_eq!(result.all_recipients().len(), result.total_count());
}

#[test]
fn dedup_works_for_doc_owner_with_different_casing() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    // Mention uses mixed case for the owner
    let result = compute_notification_recipients(
        Some(&sender),
        &["macro|Owner@Test.COM".to_string()], // mixed case
        &[sender.as_ref().to_string()],
        &owner,
        false,
    );

    assert!(
        result.mention_recipients.len() == 1,
        "owner should get mention"
    );
    assert!(
        result.doc_owner_recipient.is_none(),
        "owner should NOT also get doc owner notification"
    );
}

// ---------------------------------------------------------------------------
// Sender exclusion
// ---------------------------------------------------------------------------

#[test]
fn sender_never_receives_notification() {
    let sender = user_id("macro|sender@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[],
        &[sender.as_ref().to_string()], // sender is only thread participant
        &sender,                        // sender is also doc owner
        true,
    );

    assert!(result.mention_recipients.is_empty());
    assert!(result.thread_reply_recipients.is_empty());
    assert!(result.doc_owner_recipient.is_none());
    assert_eq!(result.total_count(), 0);
}

// ---------------------------------------------------------------------------
// Basic happy paths
// ---------------------------------------------------------------------------

#[test]
fn new_thread_comment_notifies_doc_owner() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[],
        &[sender.as_ref().to_string()], // only one comment (the new one)
        &owner,
        false, // not a reply
    );

    assert!(result.mention_recipients.is_empty());
    assert!(result.thread_reply_recipients.is_empty());
    assert_eq!(result.doc_owner_recipient.as_deref(), Some(owner.as_ref()),);
}

#[test]
fn reply_notifies_thread_participants_and_doc_owner() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");
    let alice = "macro|alice@test.com";

    let result = compute_notification_recipients(
        Some(&sender),
        &[],
        &[alice.to_string(), sender.as_ref().to_string()],
        &owner,
        true,
    );

    assert!(result.mention_recipients.is_empty());
    assert!(result.thread_reply_recipients.contains(&user_id(alice)));
    assert_eq!(result.doc_owner_recipient.as_deref(), Some(owner.as_ref()));
}

#[test]
fn no_thread_reply_notifications_for_first_comment() {
    let sender = user_id("macro|sender@test.com");
    let owner = user_id("macro|owner@test.com");

    let result = compute_notification_recipients(
        Some(&sender),
        &[],
        &[sender.as_ref().to_string()],
        &owner,
        false, // first comment, not a reply
    );

    assert!(result.thread_reply_recipients.is_empty());
}
