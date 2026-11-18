//! The record a scenario leaves of what it made the backend do, which the
//! coverage report is built from.

use email_e2e::{Mail, Provider, Report, Stack};
use serde_json::{Value, json};

/// Whether `items` has one whose fields equal those of `wanted`.
fn has(items: &Value, wanted: &Value) -> bool {
    let (Some(items), Some(wanted)) = (items.as_array(), wanted.as_object()) else {
        return false;
    };
    items
        .iter()
        .any(|item| wanted.iter().all(|(key, value)| &item[key] == value))
}

/// Starring a thread leaves a record of every hop it took: the request the
/// API served, the provider method that carried it, and the events published.
/// When this fails the coverage report under-counts or over-counts: it would
/// call a function covered that no scenario performed, or miss one that was.
async fn starring_a_thread_is_recorded(
    provider: Provider,
    name: &str,
    modifies: &str,
) -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link(provider, ada.email()).await?;
    let mail = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Budget review",
        "Numbers attached.",
    ))?;
    let preview = inbox.wait_for_preview("inbox", "Budget review").await?;
    let thread = preview["id"].as_str().unwrap_or_default();
    inbox
        .patch(
            &format!("/email/threads/{thread}/state"),
            Some(&json!({ "field": "starred", "value": true })),
        )
        .await?
        .ok()?;
    inbox
        .wait_for_provider_message("the message to be starred at the provider", |message| {
            message.id == mail.id && message.starred
        })
        .await?;

    let path = stack.evidence_path();
    stack.finish().await?;
    let text = std::fs::read_to_string(&path)
        .map_err(|error| rootcause::report!("no evidence at {}: {error}", path.display()))?;
    let evidence: Value = serde_json::from_str(&text)
        .map_err(|error| rootcause::report!("the evidence is not JSON: {error}"))?;

    assert_eq!(evidence["binary"], "evidence");
    assert_eq!(evidence["providers"], json!([name]));
    assert!(
        has(
            &evidence["http"],
            &json!({
                "service": "email_service",
                "method": "PATCH",
                "path": "/email/threads/{}/state",
                "body": { "field": "starred", "value": true },
                "status": 204,
            })
        ),
        "the request is not in {}",
        evidence["http"]
    );
    assert!(
        has(
            &evidence["provider"],
            &json!({ "provider": name, "route": modifies })
        ),
        "the provider call is not in {}",
        evidence["provider"]
    );
    assert!(
        evidence["kafka"].as_array().is_some_and(|events| events
            .iter()
            .any(|event| event["event"] == "email.message_received")),
        "the event is not in {}",
        evidence["kafka"]
    );
    // Nothing a person wrote is kept: not the subject, not an address.
    assert!(!text.contains("Budget review") && !text.contains("grace@example.com"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_starring_a_thread_is_recorded() -> Result<(), Report> {
    starring_a_thread_is_recorded(Provider::Gmail, "gmail", "messages.modify").await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_starring_a_thread_is_recorded() -> Result<(), Report> {
    starring_a_thread_is_recorded(Provider::Outlook, "outlook", "messages.update").await
}
