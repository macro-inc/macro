//! Email in the CRM: the threads a team's members hold with a company's
//! domain or one contact's address, as the company and contact pages list
//! them, and the contacts the CRM learns from the mail.

#![expect(
    clippy::disallowed_methods,
    reason = "the scenario seeds a team and its CRM rows, which the services not started here would create"
)]

use std::time::Duration;

use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, User, eventually,
};
use reqwest::Method;
use serde_json::{Value, json};
use uuid::Uuid;

/// The company's domain. The CRM keeps nobody under a reserved name such
/// as `.test`, so this is one a company could have.
const COMPANY: &str = "acmewidgets.co";

/// A team of the two users with `COMPANY` among its CRM companies, each
/// member sharing their primary inbox's mail with the team.
async fn seed_team(stack: &Stack, members: &[(&User, &Inbox)]) -> Result<(), Report> {
    let team = Uuid::now_v7();
    let company = Uuid::now_v7();
    let db = stack.db();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sellers', $2)")
        .bind(team)
        .bind(members[0].0.macro_id())
        .execute(db)
        .await?;
    for (index, (user, _)) in members.iter().enumerate() {
        sqlx::query(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::team_role)",
        )
        .bind(user.macro_id())
        .bind(team)
        .bind(if index == 0 { "owner" } else { "member" })
        .execute(db)
        .await?;
    }
    sqlx::query(
        "INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction) \
         VALUES ($1, $2, TRUE, now(), now())",
    )
    .bind(company)
    .bind(team)
    .execute(db)
    .await?;
    sqlx::query("INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)")
        .bind(company)
        .bind(team)
        .bind(COMPANY)
        .execute(db)
        .await?;
    for (user, primary) in members {
        sqlx::query(
            "INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled) \
             VALUES ($1, $2, $3, TRUE)",
        )
        .bind(team)
        .bind(user.macro_id())
        .bind(primary.link_id())
        .execute(db)
        .await?;
    }
    Ok(())
}

/// The email threads the company page lists for `domain`, as `user`: the
/// answer's status and the threads' names with their owners.
async fn company_threads(
    user: &User,
    domain: &str,
) -> Result<(u16, Vec<(String, String)>), Report> {
    let answer = user
        .email_list_page(
            &json!({ "ecd": [domain], "emailView": "all", "limit": 100 }),
            None,
        )
        .await?;
    let mut threads: Vec<(String, String)> = answer.json["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["tag"] == "emailThread")
        .map(|item| {
            let text = |field: &str| item["data"][field].as_str().unwrap_or_default().to_owned();
            (text("name"), text("ownerId"))
        })
        .collect();
    threads.sort_unstable();
    Ok((answer.status, threads))
}

/// A company's page lists each conversation the team has with it once, from
/// the members' primary inboxes only; a domain the team's CRM does not know
/// lists nothing, and a scope that is not a domain is refused. When this
/// fails a conversation two teammates are on shows twice, mail from a
/// member's other inbox is shown to the team, or a bad scope lists mail.
async fn company_page_lists_each_team_conversation_once(provider: Provider) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let ada_primary = ada.link(provider, ada.email()).await?;
    let ada_other = ada.link(provider, "ada.private@example.com").await?;
    let bob_primary = bob.link(provider, bob.email()).await?;
    seed_team(&stack, &[(&ada, &ada_primary), (&bob, &bob_primary)]).await?;

    let shared = Mail {
        to: Some(format!("{}, {}", ada.email(), bob.email())),
        message_id: Some(format!("renewal-1@{COMPANY}")),
        ..Mail::new(
            &format!("Carol <carol@{COMPANY}>"),
            "Renewal",
            "Shall we renew?",
        )
    };
    ada_primary.deliver(&shared)?;
    bob_primary.deliver(&shared)?;
    bob_primary.deliver(&Mail::new(
        &format!("Carol <carol@{COMPANY}>"),
        "Invoice",
        "Attached.",
    ))?;
    ada_primary.deliver(&Mail::new(
        "Dave <dave@other.test>",
        "Unrelated",
        "Not a company of ours.",
    ))?;
    ada_other.deliver(&Mail::new(
        &format!("Carol <carol@{COMPANY}>"),
        "Private",
        "Between us.",
    ))?;
    ada_primary.wait_for_preview("inbox", "Renewal").await?;
    bob_primary.wait_for_preview("inbox", "Renewal").await?;
    bob_primary.wait_for_preview("inbox", "Invoice").await?;
    ada_other.wait_for_preview("inbox", "Private").await?;
    ada_primary.wait_for_preview("inbox", "Unrelated").await?;

    let (status, threads) = company_threads(&ada, COMPANY).await?;
    assert_eq!(status, 200);
    assert_eq!(
        threads,
        [
            ("Invoice".to_owned(), bob.macro_id().to_owned()),
            ("Renewal".to_owned(), ada.macro_id().to_owned()),
        ],
        "one row per conversation, the viewer's own copy first, primaries only"
    );

    let (status, threads) = company_threads(&ada, "other.test").await?;
    assert_eq!((status, threads), (200, Vec::new()));
    let (status, threads) = company_threads(&ada, "not a domain").await?;
    assert_eq!((status, threads), (400, Vec::new()));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_company_page_lists_each_team_conversation_once() -> Result<(), Report> {
    company_page_lists_each_team_conversation_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_company_page_lists_each_team_conversation_once() -> Result<(), Report> {
    company_page_lists_each_team_conversation_once(Provider::Outlook).await
}

/// The team's CRM contact with this address as `user` sees it, or null
/// when the CRM has none.
async fn contact(user: &User, address: &str) -> Result<Value, Report> {
    let found = user
        .document_storage_request(
            Method::GET,
            &format!("/crm/contacts/by-email?email={address}"),
            None,
        )
        .await?
        .ok()?;
    Ok(found["contact"].clone())
}

/// Waits until the team's CRM has a contact with this address.
async fn wait_for_contact(user: &User, address: &str) -> Result<Value, Report> {
    eventually(
        &format!("the CRM to have the contact {address}"),
        DEFAULT_TIMEOUT,
        async || {
            let contact = contact(user, address).await?;
            Ok((!contact.is_null()).then_some(contact))
        },
    )
    .await
}

/// The email threads a contact's page lists for `address`, as `user`: the
/// answer's status and the threads' names.
async fn contact_threads(user: &User, address: &str) -> Result<(u16, Vec<String>), Report> {
    let answer = user
        .email_list_page(
            &json!({ "eca": [address], "emailView": "all", "limit": 100 }),
            None,
        )
        .await?;
    let mut threads: Vec<String> = answer.json["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["tag"] == "emailThread")
        .map(|item| item["data"]["name"].as_str().unwrap_or_default().to_owned())
        .collect();
    threads.sort_unstable();
    Ok((answer.status, threads))
}

/// A mail written to a CRM contact leaves through the provider, and the
/// contact's page lists the mail exchanged with that address, sent and
/// received, and nobody else's. When this fails a contact's page is empty,
/// or shows the mail of everyone at the contact's company.
async fn a_contacts_page_lists_the_mail_exchanged_with_them(
    provider: Provider,
) -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let ada_primary = ada.link(provider, ada.email()).await?;
    let bob_primary = bob.link(provider, bob.email()).await?;
    seed_team(&stack, &[(&ada, &ada_primary), (&bob, &bob_primary)]).await?;
    let carol = format!("carol@{COMPANY}");
    let dave = format!("dave@{COMPANY}");

    ada_primary.deliver(&Mail::new(
        &format!("Carol <{carol}>"),
        "Renewal",
        "Shall we renew?",
    ))?;
    ada_primary.deliver(&Mail::new(
        &format!("Dave <{dave}>"),
        "Invoice",
        "Attached.",
    ))?;
    ada_primary.wait_for_preview("inbox", "Renewal").await?;
    ada_primary.wait_for_preview("inbox", "Invoice").await?;
    // A page exists for an address once the CRM knows it as a contact.
    wait_for_contact(&ada, &carol).await?;
    wait_for_contact(&ada, &dave).await?;

    let sent = ada_primary
        .send(&json!({
            "subject": "Proposal",
            "to": [{ "email": carol, "name": "Carol" }],
            "body_text": "Our offer is attached.",
        }))
        .await?;
    assert_eq!(sent["to"][0]["email"], carol.as_str(), "{sent}");
    ada_primary.wait_for_preview("sent", "Proposal").await?;
    let at_provider = ada_primary
        .wait_for_provider_message(
            "the mail to the contact in the sender's mailbox",
            |message| {
                message.subject == "Proposal"
                    && !message
                        .labels
                        .iter()
                        .any(|label| label == "DRAFT" || label.eq_ignore_ascii_case("drafts"))
            },
        )
        .await?;
    assert!(!at_provider.in_inbox, "{at_provider:?}");

    let (status, threads) = contact_threads(&ada, &carol).await?;
    assert_eq!(status, 200);
    assert_eq!(threads, ["Proposal", "Renewal"]);
    let (status, threads) = contact_threads(&ada, &dave).await?;
    assert_eq!((status, threads), (200, vec!["Invoice".to_owned()]));

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_contacts_page_lists_the_mail_exchanged_with_them() -> Result<(), Report> {
    a_contacts_page_lists_the_mail_exchanged_with_them(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_contacts_page_lists_the_mail_exchanged_with_them() -> Result<(), Report> {
    a_contacts_page_lists_the_mail_exchanged_with_them(Provider::Outlook).await
}

/// How many times the CRM names the inbox as where it learned of the
/// contact with this address.
async fn sources(stack: &Stack, inbox: &Inbox, address: &str) -> Result<i64, Report> {
    Ok(sqlx::query_scalar(
        "SELECT count(*) FROM crm_contact_sources s \
         JOIN crm_contact_emails e ON e.contact_id = s.contact_id \
         WHERE s.link_id = $1 AND e.email = $2",
    )
    .bind(inbox.link_id())
    .bind(address)
    .fetch_one(stack.db())
    .await?)
}

/// How long a deletion at the provider may take to show: Outlook looks for
/// a message it cannot find twice more before it gives it up.
const DELETION_SETTLES: Duration = Duration::from_secs(240);

/// A team's two members with their primary inboxes, on a stack that serves
/// the CRM's routes.
async fn team_of_two(provider: Provider) -> Result<(Stack, User, User, Inbox), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;
    let bob = stack.user("bob").await?;
    let ada_primary = ada.link(provider, ada.email()).await?;
    let bob_primary = bob.link(provider, bob.email()).await?;
    seed_team(&stack, &[(&ada, &ada_primary), (&bob, &bob_primary)]).await?;
    Ok((stack, ada, bob, ada_primary))
}

/// Someone at a company the team tracks who writes to a member becomes a
/// contact of the team's CRM, once, however much they write. When this
/// fails the CRM never learns who the team corresponds with, or lists a
/// correspondent twice.
async fn a_correspondent_joins_the_crm_once(provider: Provider) -> Result<(), Report> {
    let (stack, ada, bob, ada_primary) = team_of_two(provider).await?;
    let carol = format!("carol@{COMPANY}");
    let dave = format!("dave@{COMPANY}");
    assert_eq!(contact(&ada, &carol).await?, Value::Null);

    let first = ada_primary.deliver(&Mail::new(
        &format!("Carol <{carol}>"),
        "Renewal",
        "Shall we renew?",
    ))?;
    ada_primary.wait_for_preview("inbox", "Renewal").await?;
    let added = wait_for_contact(&ada, &carol).await?;
    assert_eq!(added["email"], carol.as_str(), "{added}");
    assert_eq!(added["name"], "Carol", "{added}");
    assert!(added["companyId"].is_string(), "{added}");
    // A teammate sees the same contact.
    assert_eq!(contact(&bob, &carol).await?["id"], added["id"]);

    // More mail from her, then mail from a colleague of hers: once the
    // colleague is a contact, her second mail has been through the CRM too.
    ada_primary.deliver(&Mail::new(
        &format!("Carol <{carol}>"),
        "Renewal terms",
        "Here they are.",
    ))?;
    ada_primary
        .wait_for_preview("inbox", "Renewal terms")
        .await?;
    ada_primary.deliver(&Mail::new(
        &format!("Dave <{dave}>"),
        "Invoice",
        "Attached.",
    ))?;
    wait_for_contact(&ada, &dave).await?;
    assert_eq!(contact(&ada, &carol).await?["id"], added["id"]);
    assert_eq!(sources(&stack, &ada_primary, &carol).await?, 1);
    // The mail the CRM learned of her from is still in the mailbox.
    assert!(
        ada_primary
            .provider_messages()?
            .iter()
            .any(|message| message.id == first.id && message.in_inbox),
        "the mail is no longer in the provider's inbox"
    );

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_correspondent_joins_the_crm_once() -> Result<(), Report> {
    a_correspondent_joins_the_crm_once(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_a_correspondent_joins_the_crm_once() -> Result<(), Report> {
    a_correspondent_joins_the_crm_once(Provider::Outlook).await
}

/// When a correspondent's mail is deleted from the mailbox the nightly
/// cleanup takes them out of the team's CRM again and leaves the other
/// contacts. When this fails the CRM keeps people whose mail is gone.
async fn a_correspondent_leaves_the_crm_with_their_mail(provider: Provider) -> Result<(), Report> {
    let (stack, ada, _bob, ada_primary) = team_of_two(provider).await?;
    let carol = format!("carol@{COMPANY}");
    let dave = format!("dave@{COMPANY}");
    let doomed = ada_primary.deliver(&Mail::new(
        &format!("Carol <{carol}>"),
        "Renewal",
        "Shall we renew?",
    ))?;
    ada_primary.deliver(&Mail::new(
        &format!("Dave <{dave}>"),
        "Invoice",
        "Attached.",
    ))?;
    wait_for_contact(&ada, &carol).await?;
    wait_for_contact(&ada, &dave).await?;

    // Her mail is deleted in the mailbox; the cleanup runs at night, on a
    // message a timer puts on its queue.
    match provider {
        Provider::Gmail => stack
            .gmail()
            .delete_message(ada_primary.email(), &doomed.id)?,
        Provider::Outlook => stack
            .outlook()
            .delete_message(ada_primary.email(), &doomed.id)?,
    }
    assert!(
        ada_primary
            .provider_messages()?
            .iter()
            .all(|message| message.id != doomed.id),
        "the provider still has the deleted mail"
    );
    eventually(
        "the deleted mail to leave every view",
        DELETION_SETTLES,
        async || {
            let left = ada_primary.previews("all").await?;
            Ok(left
                .iter()
                .all(|preview| preview["name"] == "Invoice")
                .then_some(()))
        },
    )
    .await?;
    stack
        .send_to_queue("crm-cleanup", &json!({ "operation": "start_job" }))
        .await?;
    eventually(
        "the cleanup to take the correspondent out of the CRM",
        DEFAULT_TIMEOUT,
        async || Ok(contact(&ada, &carol).await?.is_null().then_some(())),
    )
    .await?;
    assert_eq!(sources(&stack, &ada_primary, &carol).await?, 0);
    assert_eq!(sources(&stack, &ada_primary, &dave).await?, 1);
    assert!(!contact(&ada, &dave).await?.is_null());

    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_correspondent_leaves_the_crm_with_their_mail() -> Result<(), Report> {
    a_correspondent_leaves_the_crm_with_their_mail(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: outlook-crm-cleanup"]
async fn outlook_a_correspondent_leaves_the_crm_with_their_mail() -> Result<(), Report> {
    a_correspondent_leaves_the_crm_with_their_mail(Provider::Outlook).await
}
