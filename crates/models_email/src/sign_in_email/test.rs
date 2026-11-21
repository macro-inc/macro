use super::*;
use serde_json::json;

const FUSIONAUTH_STACK: &str =
    include_str!("../../../../infra/stacks/fusionauth-instance/index.ts");
const FUSIONAUTH_PROD: &str =
    include_str!("../../../../infra/stacks/fusionauth-instance/Pulumi.prod.yaml");
const FUSIONAUTH_DEV: &str =
    include_str!("../../../../infra/stacks/fusionauth-instance/Pulumi.dev.yaml");
const FUSIONAUTH_LOCAL: &str =
    include_str!("../../../../infra/stacks/fusionauth-instance/Pulumi.local.yaml");
const LOCAL_KICKSTART: &str =
    include_str!("../../../../tooling/xtask/crates/xtask_local/src/local/kickstart.rs");
const LOCAL_IDENTITY: &str =
    include_str!("../../../../tooling/xtask/crates/xtask_local/src/local/identity.rs");

/// The quoted value after each `marker` in `source`.
fn quoted_after<'a>(source: &'a str, marker: &str) -> Vec<&'a str> {
    source
        .match_indices(marker)
        .filter_map(|(at, _)| {
            let rest = source[at + marker.len()..].trim_start();
            let quote = rest
                .chars()
                .next()
                .filter(|quote| matches!(quote, '\'' | '"'))?;
            rest[1..].split(quote).next()
        })
        .collect()
}

/// The from-addresses FusionAuth is configured with in every environment.
fn configured_senders() -> Vec<String> {
    let mut senders: Vec<String> = [FUSIONAUTH_PROD, FUSIONAUTH_DEV, FUSIONAUTH_LOCAL]
        .iter()
        .flat_map(|config| config.lines())
        .filter_map(|line| {
            line.trim()
                .strip_prefix("fusionauth-instance:default-from-email:")
        })
        .map(|sender| sender.trim().to_owned())
        .collect();
    senders.extend(
        quoted_after(LOCAL_IDENTITY, "pub const MAIL_FROM: &str =")
            .into_iter()
            .map(str::to_owned),
    );
    senders
}

/// The template subjects FusionAuth sends, with `${code}` rendered.
fn rendered_subjects() -> Vec<String> {
    let stack = quoted_after(FUSIONAUTH_STACK, "defaultSubject:");
    let local = quoted_after(LOCAL_KICKSTART, "\"defaultSubject\":");
    assert_eq!(
        stack.len(),
        2,
        "the stack's passwordless and verification templates"
    );
    assert_eq!(local.len(), 1, "the local passwordless template");
    stack
        .into_iter()
        .chain(local)
        .map(|subject| subject.replace("${code}", "482913"))
        .collect()
}

/// A changed sender must fail here rather than let a sign-in email through
/// to programs.
#[test]
fn every_configured_sign_in_sender_is_recognised() {
    let senders = configured_senders();
    let mut configured = senders.clone();
    configured.sort();
    configured.dedup();
    let mut known: Vec<String> = SIGN_IN_SENDERS.iter().map(|s| (*s).to_owned()).collect();
    known.sort();
    assert_eq!(configured, known, "FusionAuth's from-addresses");
    for sender in &senders {
        assert!(is_macro_sign_in_sender(sender), "{sender}");
        assert!(
            is_macro_sign_in_sender(&format!("Macro <{sender}>")),
            "{sender}"
        );
    }
}

/// Every template FusionAuth renders, from any configured sender, is hidden.
#[test]
fn every_rendered_sign_in_template_is_hidden() {
    for subject in rendered_subjects() {
        for sender in configured_senders() {
            let mut message = json!({"subject": subject, "from": {"email": sender}});
            hide_sign_in_emails(&mut message);
            assert_eq!(message["subject"], HIDDEN_SIGN_IN_EMAIL, "{subject}");
        }
    }
}

#[test]
fn mail_from_anyone_else_is_not_a_sign_in() {
    assert!(!is_macro_sign_in_sender("someone@example.com"));
    assert!(!is_macro_sign_in_sender(
        "Macro <auth@macro.com.example.com>"
    ));
    let mut message =
        json!({"subject": "Log into Macro - 482913", "from": {"email": "someone@example.com"}});
    hide_sign_in_emails(&mut message);
    assert_eq!(message["subject"], "Log into Macro - 482913");
}

#[test]
fn a_parsed_message_loses_its_subject_text_and_headers() {
    let mut message = json!({
        "db_id": "m1",
        "subject": "Log into Macro - 482913",
        "from": {"email": "auth@macro.com", "name": "Macro"},
        "snippet": "Your temporary code to log in to Macro. 482913",
        "body_text": "Here is your temporary login code: 482913",
        "body_html_sanitized": "<p>482913</p>",
        "headers_json": {"Subject": "Log into Macro - 482913"},
    });

    hide_sign_in_emails(&mut message);

    assert!(!message.to_string().contains("482913"), "{message}");
    assert_eq!(message["db_id"], "m1");
    assert_eq!(message["from"]["email"], "auth@macro.com");
}

#[test]
fn a_thread_hides_only_its_sign_in_messages() {
    let mut thread = json!({
        "messages": [
            {"subject": "Log into Macro - 482913", "from": {"email": "auth@macro.com"}, "body_text": "482913"},
            {"subject": "Lunch?", "from": {"email": "friend@example.com"}, "body_text": "noon"},
        ],
    });

    hide_sign_in_emails(&mut thread);

    assert!(!thread.to_string().contains("482913"), "{thread}");
    assert_eq!(thread["messages"][1]["body_text"], "noon");
}

#[test]
fn a_workspace_preview_and_a_search_result_are_hidden() {
    let mut workspace = json!([{
        "id": "t1",
        "name": "Log into Macro - 482913",
        "snippet": "482913",
        "senderEmail": "auth@macro.com",
    }]);
    let mut search = json!([{
        "subject": "Log into Macro - 482913",
        "name": "Log into Macro - 482913",
        "snippet": "482913",
        "participants": [{"email": "auth@macro.com", "name": "Macro"}],
        "email_message_search_results": [
            {"sender": "auth@macro.com", "highlight": {"name": "482913", "content": ["code: 482913"]}},
        ],
    }]);

    hide_sign_in_emails(&mut workspace);
    hide_sign_in_emails(&mut search);

    assert!(!workspace.to_string().contains("482913"), "{workspace}");
    assert!(!search.to_string().contains("482913"), "{search}");
    assert_eq!(workspace[0]["id"], "t1");
}

#[test]
fn a_raw_sign_in_message_is_recognised_by_its_headers() {
    let sign_in = b"From: Macro <auth@macro.com>\r\nSubject: Log into Macro - 482913\r\n\r\nHere is your temporary login code: 482913";
    let other = b"From: Friend <friend@example.com>\r\nSubject: Log into Macro - 482913\r\n\r\nhi";

    assert!(is_macro_sign_in_eml(sign_in));
    assert!(!is_macro_sign_in_eml(other));
}
