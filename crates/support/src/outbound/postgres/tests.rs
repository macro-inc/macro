use super::*;
use chrono::Duration;
async fn seed(pool: &PgPool) -> Ticket {
    let user = "macro|support-test@acme.com";
    let macro_id = Uuid::now_v7();
    let team = Uuid::now_v7();
    let channel = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,$2,$2,$3)",
        macro_id,
        user,
        format!("stripe_{macro_id}")
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,$1,$2)"#,
        user,
        macro_id
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES($1,'Support test',$2)",
        team,
        user
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO comms_channels(id,name,channel_type,team_id,owner_id) VALUES($1,'Support','team',$2,$3)",channel,team,user).execute(pool).await.unwrap();
    let now = Utc::now();
    Ticket {
        id: Uuid::now_v7(),
        team_id: team,
        channel_id: channel,
        subject: "Webhook issue".into(),
        customer: Customer {
            email: "nina@acme.com".into(),
            name: "Nina".into(),
            company_id: None,
            contact_id: None,
            company_name: None,
        },
        status: Status::Open,
        priority: Priority::High,
        assignee_id: None,
        source: Source::Widget,
        email_thread_id: None,
        email_reply_id: None,
        agent_paused: false,
        draft: None,
        preview: "Hello".into(),
        last_customer_message_id: Some(Uuid::now_v7()),
        last_customer_at: Some(now),
        last_human_reply_at: None,
        created_at: now,
        updated_at: now,
    }
}
fn message(public: bool) -> Message {
    Message {
        id: Uuid::now_v7(),
        author_kind: Author::Human,
        author_name: "Teammate".into(),
        content: if public {
            "Public reply".into()
        } else {
            "Internal secret".into()
        },
        public,
        email_message_id: None,
        created_at: Utc::now(),
    }
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn tenant_scope(pool: PgPool) {
    let ticket = seed(&pool).await;
    let repo = PgRepository { pool };
    repo.save(&ticket, None, None).await.unwrap();
    let other = Uuid::now_v7();
    assert!(repo.ticket(other, ticket.id).await.is_err());
    assert!(
        repo.tickets(other, &TicketFilter::default())
            .await
            .unwrap()
            .is_empty()
    );
    let mut forged = ticket.clone();
    forged.team_id = other;
    assert!(repo.save(&forged, None, None).await.is_err());
    assert_eq!(
        repo.ticket(ticket.team_id, ticket.id)
            .await
            .unwrap()
            .team_id,
        ticket.team_id
    );
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn visitor_visibility_and_origin(pool: PgPool) {
    let ticket = seed(&pool).await;
    let repo = PgRepository { pool: pool.clone() };
    repo.save(&ticket, Some(&message(false)), None)
        .await
        .unwrap();
    repo.save(&ticket, Some(&message(true)), None)
        .await
        .unwrap();
    assert_eq!(
        repo.messages(ticket.team_id, ticket.id, false)
            .await
            .unwrap()
            .len(),
        2
    );
    let public = repo
        .messages(ticket.team_id, ticket.id, true)
        .await
        .unwrap();
    assert_eq!(public.len(), 1);
    assert_eq!(public[0].content, "Public reply");
    repo.save_visitor(b"hashed-token", ticket.id, "https://acme.com")
        .await
        .unwrap();
    assert_eq!(
        repo.visitor(b"hashed-token", "https://acme.com")
            .await
            .unwrap()
            .1,
        ticket.id
    );
    assert!(
        repo.visitor(b"hashed-token", "https://evil.com")
            .await
            .is_err()
    );
    assert!(repo.visitor(b"unknown", "https://acme.com").await.is_err());
    sqlx::query!("UPDATE support_visitor_sessions SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.visitor(b"hashed-token", "https://acme.com")
            .await
            .is_err()
    );
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn stale_job_cannot_delete_new_trigger(pool: PgPool) {
    let mut ticket = seed(&pool).await;
    let repo = PgRepository { pool };
    repo.save(
        &ticket,
        Some(&message(true)),
        Some(Utc::now() - Duration::seconds(1)),
    )
    .await
    .unwrap();
    let jobs = repo.jobs().await.unwrap();
    assert_eq!(jobs.len(), 1);
    assert!(repo.jobs().await.unwrap().is_empty());
    ticket.last_customer_message_id = Some(Uuid::now_v7());
    repo.save(&ticket, None, Some(Utc::now() - Duration::seconds(1)))
        .await
        .unwrap();
    repo.finish_job(&jobs[0], None).await.unwrap();
    let next = repo.jobs().await.unwrap();
    assert_eq!(next.len(), 1);
    assert_eq!(Some(next[0].trigger_id), ticket.last_customer_message_id);
    repo.finish_job(&next[0], None).await.unwrap();
    assert!(repo.jobs().await.unwrap().is_empty());
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn deleting_task_preserves_ticket(pool: PgPool) {
    let ticket = seed(&pool).await;
    let repo = PgRepository { pool: pool.clone() };
    repo.save(&ticket, None, None).await.unwrap();
    let task = Uuid::now_v7().to_string();
    sqlx::query!(r#"INSERT INTO "Document"(id,name,owner,"fileType") VALUES($1,'Engineering follow-up','macro|support-test@acme.com','md')"#,task).execute(&pool).await.unwrap();
    repo.link_task(ticket.team_id, ticket.id, &task, false)
        .await
        .unwrap();
    assert_eq!(
        repo.tasks(ticket.team_id, ticket.id).await.unwrap(),
        vec![task.clone()]
    );
    sqlx::query!(r#"DELETE FROM "Document" WHERE id=$1"#, task)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.tasks(ticket.team_id, ticket.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.ticket(ticket.team_id, ticket.id).await.unwrap().status,
        Status::Open
    );
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn stable_ticket_cursor(pool: PgPool) {
    let mut first = seed(&pool).await;
    let repo = PgRepository { pool: pool.clone() };
    repo.save(&first, None, None).await.unwrap();
    let next_channel = Uuid::now_v7();
    sqlx::query!("INSERT INTO comms_channels(id,name,channel_type,team_id,owner_id) VALUES($1,'Support 2','team',$2,'macro|support-test@acme.com')",next_channel,first.team_id).execute(&pool).await.unwrap();
    first.id = Uuid::now_v7();
    first.channel_id = next_channel;
    repo.save(&first, None, None).await.unwrap();
    let list = repo
        .tickets(first.team_id, &TicketFilter::default())
        .await
        .unwrap();
    assert_eq!(list.len(), 2);
    let filter = TicketFilter {
        before: Some(list[0].updated_at),
        before_id: Some(list[0].id),
        ..Default::default()
    };
    let older = repo.tickets(first.team_id, &filter).await.unwrap();
    assert_eq!(older.len(), 1);
    assert_ne!(older[0].id, list[0].id);
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn rate_limit_and_message_replay(pool: PgPool) {
    let ticket = seed(&pool).await;
    let repo = PgRepository { pool };
    let message = message(true);
    repo.save(&ticket, Some(&message), None).await.unwrap();
    repo.save(&ticket, Some(&message), None).await.unwrap();
    assert_eq!(
        repo.messages(ticket.team_id, ticket.id, false)
            .await
            .unwrap()
            .len(),
        1
    );
    repo.rate("test", 2).await.unwrap();
    repo.rate("test", 2).await.unwrap();
    assert!(matches!(
        repo.rate("test", 2).await,
        Err(Error::RateLimited)
    ));
}
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn ticket_lock_serializes_requests(pool: PgPool) {
    let repo = PgRepository { pool };
    let id = Uuid::now_v7();
    let lock = repo.lock(id).await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), repo.lock(id))
            .await
            .is_err()
    );
    drop(lock);
    assert!(repo.lock(id).await.is_ok());
}
