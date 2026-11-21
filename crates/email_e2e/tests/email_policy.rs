//! The real outbox publisher and backfill workers retain the policy generation
//! that authorized a history job, including delayed and duplicate deliveries.

#![expect(
    clippy::disallowed_methods,
    reason = "test fixtures seed team and rule storage; production activation is separately exercised through authenticated CRM routes"
)]

use crm::{
    domain::email_policy::{EmailPolicyRepository, EmailPolicyTransaction, OpenEmailPolicy},
    outbound::companies_repo::CompaniesRepositoryImpl,
};
use email_e2e::{DEFAULT_TIMEOUT, Mail, Provider, Report, Stack, eventually};
use serde_json::json;
use uuid::Uuid;

/// A queued history job cannot adopt a replacement policy; duplicate delivery
/// cannot recreate finished work or duplicate the contact's mailbox source.
async fn replaced_policy_history_is_generation_bound(provider: Provider) -> Result<(), Report> {
    let mut stack = Stack::start().await?;
    let member = stack.user("member").await?;
    let inbox = member.link(provider, member.email()).await?;
    for (address, subject) in [
        ("first@example.org", "First conversation"),
        ("second@example.org", "Second conversation"),
    ] {
        inbox.deliver(&Mail::new(address, subject, "Historical message"))?;
        inbox.wait_for_preview("inbox", subject).await?;
    }
    stack.stop_workers().await;

    // The stack does not run team provisioning. Seed its rows only after the
    // provider's mail is imported, so only historical work can populate CRM.
    let team = Uuid::now_v7();
    let company = Uuid::now_v7();
    let incarnation = Uuid::now_v7();
    sqlx::query("INSERT INTO team(id,name,owner_id) VALUES($1,'Fixture team',$2)")
        .bind(team)
        .bind(member.macro_id())
        .execute(stack.db())
        .await?;
    sqlx::query("INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,'owner')")
        .bind(team)
        .bind(member.macro_id())
        .execute(stack.db())
        .await?;
    sqlx::query("INSERT INTO crm_companies(id,team_id,email_sync,first_interaction,last_interaction) VALUES($1,$2,TRUE,now(),now())")
        .bind(company).bind(team).execute(stack.db()).await?;
    sqlx::query("INSERT INTO crm_domains(company_id,team_id,domain) VALUES($1,$2,'example.org')")
        .bind(company)
        .bind(team)
        .execute(stack.db())
        .await?;
    sqlx::query("INSERT INTO crm_email_consent(team_id,user_id,link_id,consent_incarnation) VALUES($1,$2,$3,$4)")
        .bind(team).bind(member.macro_id()).bind(inbox.link_id()).bind(incarnation)
        .execute(stack.db()).await?;

    let repository = CompaniesRepositoryImpl::new(stack.db().clone());
    let mut deliveries = Vec::new();
    for (revision, address) in [(1_i64, "first@example.org"), (2_i64, "second@example.org")] {
        let definition = json!({
            "schema_version": 1,
            "include": [{"kind": "address", "address": address}]
        });
        sqlx::query("INSERT INTO crm_email_rule_revisions(team_id,user_id,revision,link_id,schema_version,definition) VALUES($1,$2,$3,$4,1,$5)")
            .bind(team).bind(member.macro_id()).bind(revision).bind(inbox.link_id()).bind(definition)
            .execute(stack.db()).await?;
        sqlx::query("INSERT INTO crm_email_rule_addresses(team_id,user_id,revision,address) VALUES($1,$2,$3,$4)")
            .bind(team).bind(member.macro_id()).bind(revision).bind(address)
            .execute(stack.db()).await?;
        sqlx::query("UPDATE crm_email_consent SET mode='selected',selected_enabled=TRUE,active_rule_revision=$3 WHERE team_id=$1 AND user_id=$2")
            .bind(team).bind(member.macro_id()).bind(revision).execute(stack.db()).await?;
        let mut tx = repository
            .open_email_policy(
                team,
                member.macro_id(),
                OpenEmailPolicy::Existing {
                    consent_incarnation: incarnation,
                },
            )
            .await?
            .expect("the member's consent exists");
        let generation = tx.state().generation;
        let work_id = Uuid::now_v7();
        tx.request_work(work_id, None).await?;
        tx.commit().await?;
        deliveries.push(json!({"backfillOperation": {"populate_crm_policy": {
            "team_id": team,
            "macro_id": member.macro_id(),
            "link_id": inbox.link_id(),
            "work_id": work_id,
            "consent_incarnation": incarnation,
            "policy_version": generation.policy_version,
        }}}));
    }
    // The real publisher will enqueue the current outbox. Deliver the earlier
    // generation twice before restarting, as a delayed queue retry would.
    for _ in 0..2 {
        stack.send_to_queue("backfill", &deliveries[0]).await?;
    }
    stack.start_workers()?;
    eventually(
        "current policy history to finish through the outbox and queue",
        DEFAULT_TIMEOUT,
        async || {
            let current: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM crm_contacts WHERE team_id=$1 AND email='second@example.org') AND NOT EXISTS(SELECT 1 FROM crm_email_policy_work WHERE team_id=$1) AND NOT EXISTS(SELECT 1 FROM crm_email_backfill_outbox WHERE team_id=$1)",
            )
            .bind(team)
            .fetch_one(stack.db())
            .await?;
            Ok(current.then_some(()))
        },
    )
    .await?;
    // Once finished, an exact duplicate must remain a no-op. Wait for every
    // delivery to be acknowledged before asserting durable effects.
    for _ in 0..2 {
        stack.send_to_queue("backfill", &deliveries[1]).await?;
    }
    eventually(
        "policy retries to be acknowledged",
        DEFAULT_TIMEOUT,
        async || Ok((stack.queue_depth("backfill").await? == 0).then_some(())),
    )
    .await?;
    let contacts: Vec<String> =
        sqlx::query_scalar("SELECT email FROM crm_contacts WHERE team_id=$1 ORDER BY email")
            .bind(team)
            .fetch_all(stack.db())
            .await?;
    assert_eq!(contacts, ["second@example.org"]);
    let sources: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM crm_contact_sources s JOIN crm_contacts c ON c.id=s.contact_id WHERE c.team_id=$1 AND s.link_id=$2",
    )
    .bind(team)
    .bind(inbox.link_id())
    .fetch_one(stack.db())
    .await?;
    assert_eq!(sources, 1);
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM crm_email_policy_work WHERE team_id=$1")
            .bind(team)
            .fetch_one(stack.db())
            .await?;
    assert_eq!(remaining, 0);
    assert_eq!(stack.dead_letters("backfill").await?, 0);
    stack.finish().await
}

#[tokio::test(flavor = "multi_thread")]
async fn gmail_replaced_policy_history_is_generation_bound() -> Result<(), Report> {
    replaced_policy_history_is_generation_bound(Provider::Gmail).await
}

#[tokio::test(flavor = "multi_thread")]
async fn outlook_replaced_policy_history_is_generation_bound() -> Result<(), Report> {
    replaced_policy_history_is_generation_bound(Provider::Outlook).await
}
