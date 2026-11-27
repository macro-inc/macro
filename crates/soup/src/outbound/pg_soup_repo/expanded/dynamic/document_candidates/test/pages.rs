//! Whole listings started from the candidates, page by page, against the
//! listing started from the caller's access: the same documents in the same
//! order, whatever the caller may or may not open.

use super::super::super::{
    ExpandedDynamicCursorArgs, ItemSource, expanded_dynamic_cursor_soup_hydrated_with,
};
use super::super::{CandidateArm, DocumentCandidates};
use super::{address, documents, domain, id, task};
use crate::domain::models::{DynamicSort, SoupSortDirection};
use filter_ast::Expr;
use item_filters::{
    NotificationState,
    ast::{
        EntityFilterAst, calendar_event::CalendarEventLiteral, chat::ChatLiteral,
        document::DocumentLiteral, project::ProjectLiteral,
    },
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn,
};
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::collections::BTreeSet;
use std::sync::Arc;
use uuid::{Uuid, uuid};

const VIEWER: &str = "macro|viewer@example.com";
const SOMEONE_ELSE: &str = "macro|someone@example.com";

/// From the viewer to pat@ and sam@acme.test.
const SENT: Uuid = uuid!("f0000000-0000-7000-8000-00000000000a");
/// From sam@acme.test to the viewer and lee@globex.test.
const RECEIVED: Uuid = uuid!("f0000000-0000-7000-8000-00000000000b");

const F1: Uuid = uuid!("f1000000-0000-7000-8000-000000000001");
const F2: Uuid = uuid!("f1000000-0000-7000-8000-000000000002");
const F3: Uuid = uuid!("f1000000-0000-7000-8000-000000000003");
const F4: Uuid = uuid!("f1000000-0000-7000-8000-000000000004");
const F5: Uuid = uuid!("f1000000-0000-7000-8000-000000000005");
const F6: Uuid = uuid!("f1000000-0000-7000-8000-000000000006");
const F7: Uuid = uuid!("f1000000-0000-7000-8000-000000000007");
const F8: Uuid = uuid!("f1000000-0000-7000-8000-000000000008");
const F9: Uuid = uuid!("f1000000-0000-7000-8000-000000000009");
const F10: Uuid = uuid!("f1000000-0000-7000-8000-000000000010");

/// Who holds the one `entity_access` row on a document.
#[derive(Clone, Copy)]
enum Grant {
    Viewer,
    /// The viewer, on a row typed as a chat.
    ViewerAsChat,
    SomeoneElse,
    None,
}

struct Seeded {
    id: Uuid,
    /// The message its attachment came in on; `None` for a document the
    /// filter names by id.
    message: Option<Uuid>,
    grant: Grant,
    name: &'static str,
    updated: &'static str,
    deleted: bool,
    /// Its value of the sort property.
    rank: Option<i32>,
    /// When the viewer last opened it.
    viewed: Option<&'static str>,
    /// The viewer's notification on it: `Some(true)` unseen, `Some(false)`
    /// seen.
    unseen: Option<bool>,
}

/// F1 and F2 tie on their update, F1 and F4 on their name, F2 and F9 on
/// their property, and the documents never opened on their view. The
/// documents the viewer must not see are the newest, so a leak shows first.
const DOCUMENTS: [Seeded; 10] = [
    Seeded {
        id: F1,
        message: Some(SENT),
        grant: Grant::Viewer,
        name: "delta",
        updated: "2024-03-01",
        deleted: false,
        rank: Some(3),
        viewed: Some("2024-04-01"),
        unseen: Some(true),
    },
    Seeded {
        id: F2,
        message: Some(RECEIVED),
        grant: Grant::Viewer,
        name: "Alpha",
        updated: "2024-03-01",
        deleted: false,
        rank: Some(1),
        viewed: None,
        unseen: Some(false),
    },
    Seeded {
        id: F3,
        message: Some(SENT),
        grant: Grant::Viewer,
        name: "deleted",
        updated: "2024-06-01",
        deleted: true,
        rank: Some(0),
        viewed: Some("2024-06-02"),
        unseen: Some(true),
    },
    Seeded {
        id: F4,
        message: Some(RECEIVED),
        grant: Grant::Viewer,
        name: "delta",
        updated: "2024-02-01",
        deleted: false,
        rank: Some(2),
        viewed: Some("2024-05-01"),
        unseen: Some(true),
    },
    Seeded {
        id: F5,
        message: Some(SENT),
        grant: Grant::Viewer,
        name: "Bravo",
        updated: "2024-01-01",
        deleted: false,
        rank: None,
        viewed: None,
        unseen: None,
    },
    Seeded {
        id: F6,
        message: Some(SENT),
        grant: Grant::ViewerAsChat,
        name: "chat grant",
        updated: "2024-06-01",
        deleted: false,
        rank: Some(0),
        viewed: Some("2024-06-02"),
        unseen: Some(true),
    },
    Seeded {
        id: F7,
        message: Some(RECEIVED),
        grant: Grant::None,
        name: "no grant",
        updated: "2024-06-01",
        deleted: false,
        rank: Some(0),
        viewed: Some("2024-06-02"),
        unseen: Some(true),
    },
    Seeded {
        id: F8,
        message: Some(SENT),
        grant: Grant::SomeoneElse,
        name: "other user",
        updated: "2024-06-01",
        deleted: false,
        rank: Some(0),
        viewed: Some("2024-06-02"),
        unseen: Some(true),
    },
    Seeded {
        id: F9,
        message: None,
        grant: Grant::Viewer,
        name: "echo",
        updated: "2024-04-01",
        deleted: false,
        rank: Some(1),
        viewed: None,
        unseen: Some(true),
    },
    Seeded {
        id: F10,
        message: None,
        grant: Grant::None,
        name: "not granted",
        updated: "2024-06-01",
        deleted: false,
        rank: Some(0),
        viewed: Some("2024-06-02"),
        unseen: Some(true),
    },
];

/// Seeds [`DOCUMENTS`] and returns the sort property's id.
async fn seed(db: &PgPool) -> anyhow::Result<Uuid> {
    let mut tx = db.begin().await?;
    // No thread, mailbox or document rows behind the foreign keys.
    sqlx::raw_sql("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *tx)
        .await?;
    let mailbox = Uuid::now_v7();
    let mut contacts = Vec::new();
    for address in [
        "viewer@example.com",
        "Pat@Acme.test",
        "sam@acme.test",
        "lee@globex.test",
    ] {
        let contact = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
            contact,
            mailbox,
            address,
        )
        .execute(&mut *tx)
        .await?;
        contacts.push(contact);
    }
    let [me, pat, sam, lee] = contacts[..] else {
        anyhow::bail!("four contacts");
    };
    for (message, sender, recipients) in [(SENT, me, [pat, sam]), (RECEIVED, sam, [me, lee])] {
        sqlx::query!(
            "INSERT INTO email_messages (id, thread_id, link_id, from_contact_id) VALUES ($1, $2, $3, $4)",
            message,
            Uuid::now_v7(),
            mailbox,
            sender,
        )
        .execute(&mut *tx)
        .await?;
        for recipient in recipients {
            sqlx::query!(
                "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'TO')",
                message,
                recipient,
            )
            .execute(&mut *tx)
            .await?;
        }
    }
    let property = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
         VALUES ($1, $2, 'Rank', 'NUMBER', false)",
        property,
        VIEWER,
    )
    .execute(&mut *tx)
    .await?;
    let mut attachments = Vec::new();
    for document in &DOCUMENTS {
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt", "deletedAt")
               VALUES ($1, $2, $3, $4::text::timestamp, $4::text::timestamp,
                       CASE WHEN $5 THEN $4::text::timestamp END)"#,
            document.id.to_string(),
            document.name,
            SOMEONE_ELSE,
            document.updated,
            document.deleted,
        )
        .execute(&mut *tx)
        .await?;
        // Past the fixture's instance ids, which leave the sequence behind.
        sqlx::query!(
            r#"INSERT INTO "DocumentInstance" (id, "documentId", sha, "createdAt", "updatedAt")
               SELECT COALESCE(MAX(id), 0) + 1, $1, 'sha', $2::text::timestamp, $2::text::timestamp
               FROM "DocumentInstance""#,
            document.id.to_string(),
            document.updated,
        )
        .execute(&mut *tx)
        .await?;
        let grant = match document.grant {
            Grant::Viewer => Some((VIEWER, "document")),
            Grant::ViewerAsChat => Some((VIEWER, "chat")),
            Grant::SomeoneElse => Some((SOMEONE_ELSE, "document")),
            Grant::None => None,
        };
        if let Some((source, entity_type)) = grant {
            sqlx::query!(
                "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
                 VALUES ($1, $2, $3, 'user', 'view')",
                document.id,
                entity_type,
                source,
            )
            .execute(&mut *tx)
            .await?;
        }
        if let Some(rank) = document.rank {
            sqlx::query!(
                "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
                 VALUES ($1, $2, 'DOCUMENT', $3, $4)",
                Uuid::now_v7(),
                document.id.to_string(),
                property,
                serde_json::json!({ "type": "Number", "value": rank }),
            )
            .execute(&mut *tx)
            .await?;
        }
        if let Some(viewed) = document.viewed {
            sqlx::query!(
                r#"INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
                   VALUES ($1, $2, 'document', $3::text::timestamp, $3::text::timestamp)"#,
                VIEWER,
                document.id.to_string(),
                viewed,
            )
            .execute(&mut *tx)
            .await?;
        }
        if let Some(unseen) = document.unseen {
            let notification = Uuid::now_v7();
            sqlx::query!(
                "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
                 VALUES ($1, 'document_comment', $2, 'document', 'test')",
                notification,
                document.id.to_string(),
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!(
                "INSERT INTO user_notification (user_id, notification_id, sent, state)
                 VALUES ($1, $2, TRUE, CASE WHEN $3 THEN 'unseen' ELSE 'seen' END::notification_state)",
                VIEWER,
                notification,
                unseen,
            )
            .execute(&mut *tx)
            .await?;
        }
        if let Some(message) = document.message {
            let attachment = Uuid::now_v7();
            sqlx::query!(
                "INSERT INTO email_attachments (id, message_id) VALUES ($1, $2)",
                attachment,
                message,
            )
            .execute(&mut *tx)
            .await?;
            attachments.push((document.id, attachment));
        }
    }
    // Linked as sync links them, so the triggers record the participants.
    sqlx::raw_sql("SET LOCAL session_replication_role = 'origin'")
        .execute(&mut *tx)
        .await?;
    for (document, attachment) in attachments {
        sqlx::query!(
            "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
            document.to_string(),
            attachment,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(property)
}

/// Where the document arm starts.
#[derive(Clone, Copy, Debug)]
enum Arm {
    Access,
    Each,
    Within,
}

fn only_documents(filter: Expr<DocumentLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..documents(filter)
    }
}

/// Every document of `filter` in `sort` order, read `limit` at a time
/// through the flat query, with its document arm started as `arm` says.
async fn listing(
    db: &PgPool,
    filter: &EntityFilterAst,
    sort: DynamicSort,
    limit: u16,
    arm: Arm,
) -> anyhow::Result<Vec<Uuid>> {
    let mut cursor = Query::Sort(sort, filter.clone());
    let mut seen = Vec::new();
    for _ in 0..=DOCUMENTS.len() {
        let page = expanded_dynamic_cursor_soup_hydrated_with(
            db,
            ExpandedDynamicCursorArgs {
                user_id: MacroUserIdStr::parse_from_str(VIEWER)?,
                limit,
                cursor,
                exclude_frecency: false,
            },
            ItemSource::ItemTables,
            |picked| {
                let candidates = picked.map(|picked| match picked {
                    CandidateArm::EachCandidate(candidates)
                    | CandidateArm::WithinAccess(candidates) => candidates,
                });
                let forced = |arm: fn(DocumentCandidates) -> CandidateArm| {
                    Some(arm(candidates.expect("the filter names participants")))
                };
                match arm {
                    Arm::Access => None,
                    Arm::Each => forced(CandidateArm::EachCandidate),
                    Arm::Within => forced(CandidateArm::WithinAccess),
                }
            },
        )
        .await?;
        let Some(last) = page.last() else {
            return Ok(seen);
        };
        seen.extend(page.iter().map(|hydration| hydration.item.id()));
        cursor = Query::Cursor(CursorWithValAndFilter {
            id: last.item.id(),
            limit: usize::from(limit),
            val: CursorVal {
                sort_type: sort,
                last_val: sort.position(
                    last.sort_key,
                    last.item.name(),
                    SoupItem::sort_on(sort.timestamp_method())(&last.item).last_val,
                ),
            },
            filter: filter.clone(),
        });
    }
    anyhow::bail!("{filter:?} never ran out of pages")
}

/// The Files tab's shape: two association ids and the record's domain.
fn files_tab() -> Expr<DocumentLiteral> {
    Expr::and(
        Expr::is_not(task()),
        Expr::or(Expr::or(id(F9), id(F10)), domain("ACME.test")),
    )
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn every_arm_pages_the_listing_access_pages(db: PgPool) -> anyhow::Result<()> {
    let property = seed(&db).await?;
    let filters = [
        (files_tab(), vec![F1, F2, F4, F5, F9]),
        (address("PAT@Acme.TEST"), vec![F1, F5]),
        (
            Expr::or(domain("globex.test"), address("pat@acme.test")),
            vec![F1, F2, F4, F5],
        ),
        // Driven from the viewer's notifications, with the candidates.
        (
            Expr::and(
                Expr::val(DocumentLiteral::NotificationState(
                    NotificationState::Unseen,
                )),
                files_tab(),
            ),
            vec![F1, F4, F9],
        ),
    ];
    let sorts = [
        DynamicSort::from(SimpleSortMethod::UpdatedAt),
        DynamicSort::from(SimpleSortMethod::ViewedAt),
        DynamicSort::name(SoupSortDirection::Asc),
        DynamicSort::Property {
            property_definition_id: property,
            direction: SoupSortDirection::Asc,
        },
    ];
    for (filter, expected) in filters {
        let filter = only_documents(filter);
        for sort in sorts {
            let from_access = listing(&db, &filter, sort, 50, Arm::Access).await?;
            assert_eq!(
                from_access.iter().copied().collect::<BTreeSet<_>>(),
                expected.iter().copied().collect(),
                "{filter:?} {sort:?}"
            );
            for (limit, arm) in [
                (2, Arm::Access),
                (2, Arm::Each),
                (50, Arm::Each),
                (2, Arm::Within),
                (50, Arm::Within),
            ] {
                assert_eq!(
                    listing(&db, &filter, sort, limit, arm).await?,
                    from_access,
                    "{arm:?} by {limit}: {filter:?} {sort:?}"
                );
            }
        }
    }
    // Ties keep their order across pages: F2 before F1 (same update, higher
    // id), F1 before F4 (same name, later update), F9 before F2 (same rank,
    // later update).
    let filter = only_documents(files_tab());
    for (sort, order) in [
        (
            DynamicSort::from(SimpleSortMethod::UpdatedAt),
            [F9, F2, F1, F4, F5],
        ),
        (
            DynamicSort::name(SoupSortDirection::Asc),
            [F2, F5, F1, F4, F9],
        ),
        (
            DynamicSort::Property {
                property_definition_id: property,
                direction: SoupSortDirection::Asc,
            },
            [F9, F2, F4, F1, F5],
        ),
        (
            DynamicSort::from(SimpleSortMethod::ViewedAt),
            [F4, F1, F9, F5, F2],
        ),
    ] {
        assert_eq!(
            listing(&db, &filter, sort, 2, Arm::Each).await?,
            order,
            "{sort:?}"
        );
    }
    Ok(())
}
