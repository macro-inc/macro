//! Which Outlook reads and writes say a thread gained a category.

use super::*;
use crate::domain::mailbox::commands::MailboxCommandRepository;
use crate::domain::models::label::LabelsGained;
use crate::domain::models::mailbox_action::MailboxAction;
use crate::domain::ports::EmailRepo;
use agent_correlation::context::{Attribution, as_program, scope_attribution};
use macro_user_id::user_id::MacroUserIdStr;

struct Mailbox {
    sync: PgMailboxSync,
    repo: crate::outbound::EmailPgRepo,
    db: PgPool,
    link: Uuid,
    lease: MessageLease,
}

impl Mailbox {
    async fn new(db: PgPool) -> Self {
        let (sync, link) = fixture(&db).await;
        let stream = sync
            .claim_stream(macro_uuid::generate_uuid_v7(), StreamClaim::LongestDue)
            .await
            .unwrap()
            .unwrap();
        sync.commit_page(&stream, &page(), POLL_INTERVALS)
            .await
            .unwrap();
        let mut lease = sync
            .claim_message(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .unwrap();
        lease.is_import = false;
        Self {
            repo: crate::outbound::EmailPgRepo::new(db.clone()),
            sync,
            db,
            link,
            lease,
        }
    }

    /// Read message `provider_id` from Outlook with these categories.
    async fn read(&self, provider_id: &str, version: &str, categories: &[&str]) {
        let provider_id = ProviderId::new(provider_id).unwrap();
        sqlx::query!(
            r#"INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import,lease_id,lease_until)
               VALUES($1,1,$2,false,$3,now()+interval '3 minutes')
               ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET lease_id=$3,lease_until=now()+interval '3 minutes'"#,
            self.link,
            provider_id.as_str(),
            self.lease.lease_id
        )
        .execute(&self.db)
        .await
        .unwrap();
        let lease = MessageLease {
            mailbox: self.lease.mailbox,
            provider_id: provider_id.clone(),
            revision: self.lease.revision,
            lease_id: self.lease.lease_id,
            is_import: self.lease.is_import,
            attempts: self.lease.attempts,
            unfinished_claims: 0,
            notification: None,
            from_notification: false,
        };
        let mut message = snapshot(self.link, provider_id.as_str(), Default::default(), version);
        message.tags = categories.iter().map(|name| (*name).to_owned()).collect();
        self.sync.ingest(&lease, message).await.unwrap();
    }

    /// The gains written since the last call, by category name.
    async fn gains(&self) -> Vec<(Vec<String>, LabelsGained)> {
        let payloads = sqlx::query_scalar!(
            "DELETE FROM email_projection_outbox WHERE link_id = $1 RETURNING payload",
            self.link
        )
        .fetch_all(&self.db)
        .await
        .unwrap();
        let mut gains = Vec::new();
        for payload in payloads {
            let gained: Option<LabelsGained> =
                serde_json::from_value(payload["labels_gained"].clone()).unwrap();
            let Some(gained) = gained else { continue };
            let names = sqlx::query_scalar!(
                "SELECT name AS \"name!\" FROM email_labels WHERE id = ANY($1) ORDER BY name",
                &gained.label_ids
            )
            .fetch_all(&self.db)
            .await
            .unwrap();
            gains.push((names, gained));
        }
        gains
    }

    async fn gained_names(&self) -> Vec<Vec<String>> {
        self.gains()
            .await
            .into_iter()
            .map(|(names, _)| names)
            .collect()
    }

    async fn thread(&self) -> Uuid {
        sqlx::query_scalar!(
            "SELECT thread_id FROM email_messages WHERE link_id = $1 LIMIT 1",
            self.link
        )
        .fetch_one(&self.db)
        .await
        .unwrap()
    }

    /// Put a category on the whole thread in Macro.
    async fn categorize(&self, name: &str) {
        sqlx::query!(
            "INSERT INTO email_labels(id,link_id,provider_label_id,name,type) VALUES($1,$2,$3::text,$3::text,'User') ON CONFLICT DO NOTHING",
            Uuid::now_v7(),
            self.link,
            name
        )
        .execute(&self.db)
        .await
        .unwrap();
        let messages = self
            .repo
            .mailbox_action_messages(self.link, self.thread().await)
            .await
            .unwrap();
        let action = MailboxAction::Category {
            name: name.into(),
            present: true,
        };
        let actor = MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap();
        self.repo
            .enqueue_mailbox_action(self.link, actor, &action, &action.targets(&messages))
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_category_counts_once_per_thread_on_arrival_and_later(db: PgPool) {
    let mailbox = Mailbox::new(db).await;

    mailbox.read("a", "v1", &["Finance"]).await;
    assert_eq!(mailbox.gained_names().await, [["Finance"]]);

    // Read again with nothing new, then categorized in Outlook.
    mailbox.read("a", "v2", &["Finance"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());
    mailbox.read("a", "v3", &["Finance", "Travel"]).await;
    assert_eq!(mailbox.gained_names().await, [["Travel"]]);

    // A reply brings a category the thread has and one it doesn't.
    mailbox.read("b", "v1", &["Finance", "Board"]).await;
    assert_eq!(mailbox.gained_names().await, [["Board"]]);

    // Removed everywhere and set again.
    mailbox.read("a", "v4", &["Travel"]).await;
    mailbox.read("b", "v2", &["Board"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());
    mailbox.read("b", "v3", &["Board", "Finance"]).await;
    assert_eq!(mailbox.gained_names().await, [["Finance"]]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_imports_gain_nothing(db: PgPool) {
    let mut mailbox = Mailbox::new(db).await;
    mailbox.lease.is_import = true;
    mailbox.read("a", "v1", &["Finance"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());

    // A later live read of the same category is not new either.
    mailbox.lease.is_import = false;
    mailbox.read("a", "v2", &["Finance"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn macros_own_category_is_gained_when_accepted_and_never_echoed(db: PgPool) {
    let mailbox = Mailbox::new(db).await;
    mailbox.read("a", "v1", &[]).await;
    mailbox.gains().await;

    mailbox.categorize("Finance").await;
    let gains = mailbox.gains().await;
    assert_eq!(gains.len(), 1);
    assert_eq!(gains[0].0, ["Finance"]);
    assert_eq!(gains[0].1.message_id, None);
    assert!(!gains[0].1.automated);

    // Outlook reports it before the command is confirmed, and after.
    mailbox.read("a", "v2", &["Finance"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());

    let command = mailbox
        .sync
        .claim_command(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    let target = mailbox
        .sync
        .command_context(&command)
        .await
        .unwrap()
        .target
        .unwrap();
    // The confirming read also shows a category someone set in Outlook.
    let mut remote = snapshot(mailbox.link, "a", Default::default(), "v3");
    remote.tags = vec!["Finance".into(), "Travel".into()];
    mailbox
        .sync
        .confirm_target(&command, &target, Some(&remote.into()))
        .await
        .unwrap();
    let gains = mailbox.gains().await;
    assert_eq!(gains.len(), 1);
    assert_eq!(gains[0].0, ["Travel"]);

    mailbox.read("a", "v4", &["Finance", "Travel"]).await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());

    // Already on the thread.
    mailbox.categorize("Finance").await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routines_or_agents_category_is_marked_automated(db: PgPool) {
    let mailbox = Mailbox::new(db).await;
    mailbox.read("a", "v1", &[]).await;
    mailbox.gains().await;

    let routine = Uuid::now_v7();
    let run = Attribution {
        routine_id: Some(routine),
        program: true,
        ..Attribution::default()
    };
    scope_attribution(run, mailbox.categorize("Finance")).await;
    let payload = sqlx::query_scalar!(
        "SELECT payload FROM email_projection_outbox WHERE link_id = $1",
        mailbox.link
    )
    .fetch_one(&mailbox.db)
    .await
    .unwrap();
    assert_eq!(payload["routine_id"], serde_json::json!(routine));
    assert!(mailbox.gains().await[0].1.automated);

    as_program(mailbox.categorize("Travel")).await;
    assert!(mailbox.gains().await[0].1.automated);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_never_gives_its_thread_a_category(db: PgPool) {
    let mailbox = Mailbox::new(db).await;
    mailbox.read("a", "v1", &[]).await;
    sqlx::query!(
        "UPDATE email_messages SET is_draft = true WHERE link_id = $1",
        mailbox.link
    )
    .execute(&mailbox.db)
    .await
    .unwrap();
    mailbox.gains().await;

    mailbox.categorize("Finance").await;
    assert_eq!(mailbox.gained_names().await, Vec::<Vec<String>>::new());
}
