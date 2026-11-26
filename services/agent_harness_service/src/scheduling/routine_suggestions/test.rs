use super::*;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, types::Uuid};

const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";
const BARRED: &str = "macro|barred@example.com";
const ALONE: &str = "macro|alone@example.com";

async fn person(pool: &PgPool, user: &str) -> sqlx::Result<()> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        id,
        user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A brief tells a person to draft routines that add CRM companies only
/// where CRM's tools would let those routines run: in a team, with CRM open
/// to them (its owners and admins always, a member unless barred).
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_team_member_with_crm_access_may_add_companies(pool: PgPool) -> anyhow::Result<()> {
    for user in [OWNER, MEMBER, BARRED, ALONE] {
        person(&pool, user).await?;
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')",
        team,
        OWNER,
        MEMBER,
        BARRED
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE user_id = $1",
        BARRED
    )
    .execute(&pool)
    .await?;
    let teams = PgAccessRepository::new(pool.clone());
    let crm = CompaniesRepositoryImpl::new(pool.clone());
    for (id, allowed) in [
        (OWNER, true),
        (MEMBER, true),
        (BARRED, false),
        (ALONE, false),
    ] {
        let user = MacroUserIdStr::parse_from_str(id)?;
        assert_eq!(team_crm_access(&teams, &crm, &user).await?, allowed, "{id}");
    }
    Ok(())
}

#[test]
fn partial_mail_context_records_typed_reason_counts() {
    use models_email::email::service::message::{UnreadableMailbox, UnreadableMailboxReason};
    let spans = crate::test_spans::exported_spans();
    let parent = tracing::info_span!(
        "partial_mail_context_test",
        test_case = "unsupported_context"
    );
    let _entered = parent.enter();
    let response = RecentInboxMessagesResponse {
        messages: vec![],
        unreadable_mailboxes: vec![
            UnreadableMailbox {
                link_id: Uuid::now_v7(),
                reason: UnreadableMailboxReason::Unsupported,
            },
            UnreadableMailbox {
                link_id: Uuid::now_v7(),
                reason: UnreadableMailboxReason::ProviderError,
            },
        ],
    };
    assert!(inbox_messages(response).is_empty());
    spans.provider.force_flush().unwrap();
    let spans = spans.exporter.get_finished_spans().unwrap();
    let context = spans
        .iter()
        .rev()
        .find(|span| span.name == "routine_suggestions.mail_context")
        .unwrap();
    for (key, expected) in [
        ("unreadable_mailbox_count", 2i64),
        ("unsupported_mailbox_count", 1),
        ("provider_error_mailbox_count", 1),
    ] {
        assert!(
            context
                .attributes
                .iter()
                .any(|attribute| attribute.key.as_str() == key
                    && attribute.value == opentelemetry::Value::I64(expected))
        );
    }
    assert_eq!(context.events.len(), 1);
    assert!(
        context.events[0]
            .attributes
            .iter()
            .any(|attribute| attribute.key.as_str() == "reason"
                && attribute.value == opentelemetry::Value::String("ProviderError".into()))
    );
    assert!(
        inbox_messages(RecentInboxMessagesResponse {
            messages: vec![],
            unreadable_mailboxes: vec![UnreadableMailbox {
                link_id: Uuid::now_v7(),
                reason: UnreadableMailboxReason::Unsupported
            }],
        })
        .is_empty()
    );
    crate::test_spans::exported_spans()
        .provider
        .force_flush()
        .unwrap();
    let spans = crate::test_spans::exported_spans()
        .exporter
        .get_finished_spans()
        .unwrap();
    let unsupported = spans
        .iter()
        .rev()
        .find(|span| span.name == "routine_suggestions.mail_context")
        .unwrap();
    assert!(unsupported.events.is_empty());
    assert!(
        unsupported
            .attributes
            .iter()
            .any(|a| a.key.as_str() == "unsupported_mailbox_count"
                && a.value == opentelemetry::Value::I64(1))
    );
}
