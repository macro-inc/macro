//! A company's email in the CRM: the threads a team's members hold with a
//! company's domain, as the company page lists them.

#![expect(
    clippy::disallowed_methods,
    reason = "the scenario seeds a team and its CRM rows, which the services not started here would create"
)]

use email_e2e::{Inbox, Mail, Provider, Report, Stack, StackOptions, User};
use serde_json::json;
use uuid::Uuid;

/// The company's domain.
const COMPANY: &str = "acme.test";

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
