//! Labels people make are theirs: a thread shared with someone else shows
//! none of them, whichever read opens it. System labels say what state a
//! message is in, so every reader of it gets them.

use super::*;
use crate::domain::models::GetEmailsRequest;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};
use macro_user_id::cowlike::CowLike;
use std::collections::BTreeMap;

const INBOX: Uuid = uuid::uuid!("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const SHARED_DIRECTLY: Uuid = uuid::uuid!("20000101-0000-0000-0000-000000000101");
const SHARED_BY_PROJECT: Uuid = uuid::uuid!("20000102-0000-0000-0000-000000000102");

/// The shared threads' inbox, and an inbox of the person they are shared with.
const SHARED_WITH_INBOX: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const DELEGATE: &str = "macro|delegate@example.com";

type Labels = BTreeMap<Uuid, Vec<String>>;

/// Both shared threads with the inbox's own labels.
fn all_labels() -> Labels {
    BTreeMap::from([
        (
            SHARED_DIRECTLY,
            vec!["Hiring/Declined".to_owned(), "INBOX".to_owned()],
        ),
        (
            SHARED_BY_PROJECT,
            vec!["INBOX".to_owned(), "Work".to_owned()],
        ),
    ])
}

/// Both shared threads with the system labels alone.
fn system_labels() -> Labels {
    BTreeMap::from([
        (SHARED_DIRECTLY, vec!["INBOX".to_owned()]),
        (SHARED_BY_PROJECT, vec!["INBOX".to_owned()]),
    ])
}

fn sorted(labels: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut labels: Vec<_> = labels.into_iter().collect();
    labels.sort();
    labels
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

/// The person who owns `inbox`.
async fn owner_of(pool: &Pool<Postgres>, inbox: Uuid) -> MacroUserIdStr<'static> {
    let owner = sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", inbox)
        .fetch_one(pool)
        .await
        .unwrap();
    user(&owner)
}

fn receipt(auth: EntityAccessAuth, thread: Uuid) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new(
        auth,
        Entity {
            entity_type: EntityType::EmailThread,
            entity_id: thread.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

/// The labels of both threads through every read a receipt opens, with the
/// name of the read.
async fn labels_by_read(
    pool: &Pool<Postgres>,
    auth: EntityAccessAuth,
) -> anyhow::Result<Vec<(&'static str, Labels)>> {
    let service = super::thread_unread::service(pool.clone());
    let receipts = || {
        [SHARED_DIRECTLY, SHARED_BY_PROJECT]
            .map(|thread| receipt(auth.clone(), thread))
            .to_vec()
    };

    let mut messages = Labels::new();
    let mut parsed_thread = Labels::new();
    let mut parsed_messages = Labels::new();
    for receipt in receipts() {
        let thread = service
            .get_thread_with_messages_impl(receipt.clone(), 0, 10)
            .await?
            .expect("the thread opens");
        messages.insert(
            thread.row.db_id,
            sorted(
                thread
                    .messages
                    .into_iter()
                    .flat_map(|message| message.labels)
                    .filter_map(|label| label.name),
            ),
        );

        let parsed = service
            .get_thread_parsed_impl(receipt, 0, 10)
            .await?
            .expect("the thread opens");
        parsed_messages.insert(
            parsed.row.db_id,
            sorted(
                parsed
                    .messages
                    .into_iter()
                    .flat_map(|message| message.labels)
                    .map(|label| label.name),
            ),
        );
        parsed_thread.insert(
            parsed.row.db_id,
            sorted(parsed.labels.into_iter().map(|label| label.name)),
        );
    }

    let latest_parsed = service
        .get_latest_messages_parsed_impl(receipts())
        .await?
        .into_iter()
        .map(|(thread, message)| {
            (
                thread,
                sorted(message.labels.into_iter().map(|label| label.name)),
            )
        })
        .collect();
    let latest_full = service
        .get_latest_messages_full_impl(receipts())
        .await?
        .into_iter()
        .map(|(thread, message)| {
            (
                thread,
                sorted(message.labels.into_iter().filter_map(|label| label.name)),
            )
        })
        .collect();

    Ok(vec![
        ("thread messages", messages),
        ("parsed thread", parsed_thread),
        ("parsed thread messages", parsed_messages),
        ("latest parsed message", latest_parsed),
        ("latest full message", latest_full),
    ])
}

/// The labels of both threads on the rows `reader` gets by id.
async fn labels_on_rows(
    pool: &Pool<Postgres>,
    reader: MacroUserIdStr<'static>,
) -> anyhow::Result<Labels> {
    let receipts = [SHARED_DIRECTLY, SHARED_BY_PROJECT]
        .map(|thread| receipt(EntityAccessAuth::Authenticated(reader.clone()), thread))
        .to_vec();
    Ok(super::thread_unread::service(pool.clone())
        .get_email_thread_previews_by_receipts_impl(reader, receipts)
        .await?
        .into_iter()
        .map(|preview| {
            (
                preview.thread.id,
                sorted(preview.labels.into_iter().map(|label| label.name)),
            )
        })
        .collect())
}

/// The labels of both threads through every read of a signed-in person, with
/// the name of the read.
async fn labels_by_person(
    pool: &Pool<Postgres>,
    reader: MacroUserIdStr<'static>,
    link_id: Uuid,
    filter: EmailLiteral,
) -> anyhow::Result<Vec<(&'static str, Labels)>> {
    let mut reads = labels_by_read(pool, EntityAccessAuth::Authenticated(reader.clone())).await?;
    reads.push(("rows by id", labels_on_rows(pool, reader.clone()).await?));
    reads.push((
        "rows in a list",
        labels_in_list(pool, reader, vec![link_id], filter).await?,
    ));
    Ok(reads)
}

/// The same labels from each of `reads`.
fn each_read(reads: &[(&'static str, Labels)], labels: Labels) -> Vec<(&'static str, Labels)> {
    reads
        .iter()
        .map(|(read, _)| (*read, labels.clone()))
        .collect()
}

/// The labels on the rows of `reader`'s list.
async fn labels_in_list(
    pool: &Pool<Postgres>,
    reader: MacroUserIdStr<'static>,
    link_ids: Vec<Uuid>,
    filter: EmailLiteral,
) -> anyhow::Result<Labels> {
    Ok(super::thread_unread::service(pool.clone())
        .get_email_thread_previews_impl(GetEmailsRequest {
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            link_ids,
            macro_id: reader,
            limit: Some(50),
            query: Query::Sort(
                SimpleSortMethod::UpdatedAt,
                Some(Arc::new(Expr::val(filter))),
            ),
            include_frecency: false,
            team_receipt: None,
            crm_scope: None,
        })
        .await?
        .items
        .into_iter()
        .filter(|preview| [SHARED_DIRECTLY, SHARED_BY_PROJECT].contains(&preview.thread.id))
        .map(|preview| {
            (
                preview.thread.id,
                sorted(preview.labels.into_iter().map(|label| label.name)),
            )
        })
        .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_label_readers")
    )
)]
async fn a_shared_thread_shows_none_of_the_labels_its_inbox_made(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let reads = labels_by_person(
        &pool,
        owner_of(&pool, SHARED_WITH_INBOX).await,
        SHARED_WITH_INBOX,
        EmailLiteral::Shared(item_filters::SharedEmailFilter::Only),
    )
    .await?;
    assert_eq!(reads, each_read(&reads, system_labels()));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_label_readers")
    )
)]
async fn a_reader_who_is_not_a_person_gets_system_labels_only(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for auth in [
        EntityAccessAuth::Unauthenticated,
        EntityAccessAuth::Internal,
    ] {
        let reads = labels_by_read(&pool, auth.clone()).await?;
        assert_eq!(reads, each_read(&reads, system_labels()), "{auth:?}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_label_readers")
    )
)]
async fn an_inbox_shows_its_labels_to_its_owner_and_to_who_manages_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for reader in [owner_of(&pool, INBOX).await, user(DELEGATE)] {
        let reads =
            labels_by_person(&pool, reader.clone(), INBOX, EmailLiteral::Owner(INBOX)).await?;
        assert_eq!(reads, each_read(&reads, all_labels()), "{reader}");
    }
    Ok(())
}
