use super::normalize::Normalizer;
use crate::pubsub::label_write_sim::fake_gmail::{GmailMessage, GmailState};
use crate::pubsub::label_write_sim::world;
use sqlx::PgPool;
use std::collections::BTreeMap;
use uuid::Uuid;

pub(super) const LABELS: [&str; 7] = [
    "INBOX",
    "UNREAD",
    "STARRED",
    "TRASH",
    "SPAM",
    "SENT",
    "Label_work",
];

pub(super) struct Fixture {
    pub links: [Uuid; 3],
    pub messages: BTreeMap<String, Uuid>,
    pub labels: BTreeMap<String, Uuid>,
    pub users: [String; 3],
    pub fusion: [String; 3],
    pub gmail: GmailState,
}

impl Fixture {
    #[expect(
        clippy::disallowed_methods,
        reason = "The parity specification requires runtime test queries without SQLx cache entries"
    )]
    pub async fn seed(db: &PgPool, shard: u32, normalizer: &mut Normalizer) -> Self {
        let users = ["a", "b", "c"].map(|name| format!("macro|parity-{name}@example.com"));
        let fusion = ["a", "b", "c"].map(|name| format!("parity-{shard}-{name}"));
        let links = [
            world::link_uuid(shard),
            world::link_uuid(shard + 1),
            world::link_uuid(shard + 2),
        ];
        let mut messages = BTreeMap::new();
        let mut labels = BTreeMap::new();
        let mut gmail = world::initial_gmail();
        for (index, user) in users.iter().enumerate() {
            let macro_id = Uuid::from_u128(
                0x5500_0000_0000_0000_0000_0000_0000_0000
                    + (u128::from(shard) << 16)
                    + index as u128,
            );
            normalizer.symbol(user, format!("<user:{}>", ['A', 'B', 'C'][index]));
            normalizer.symbol(macro_id, format!("<macro-user:{}>", ['A', 'B', 'C'][index]));
            normalizer.symbol(
                &fusion[index],
                format!("<fusion:{}>", ['A', 'B', 'C'][index]),
            );
            sqlx::query("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)")
                .bind(macro_id).bind(format!("parity-{index}")).bind(format!("parity-{index}@example.com"))
                .bind(format!("parity-{index}")).execute(db).await.expect("fixture macro user");
            sqlx::query("INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $2, $3)")
                .bind(user)
                .bind(format!("parity-{}@example.com", ['a', 'b', 'c'][index]))
                .bind(macro_id)
                .execute(db)
                .await
                .expect("fixture user");
        }
        for (inbox, link) in links.iter().enumerate() {
            let letter = ["A", "B", "A2"][inbox];
            let owner = if inbox == 2 { 0 } else { inbox };
            normalizer.symbol(link, format!("<link:{letter}>"));
            sqlx::query("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active) VALUES ($1, $2, $3, $4, 'GMAIL', true)")
                .bind(link).bind(&users[owner]).bind(&fusion[owner])
                .bind(format!("parity-{shard}-{letter}@example.com"))
                .execute(db).await.expect("fixture link");
            for (index, label) in LABELS.iter().enumerate() {
                let id = world::label_uuid(shard + inbox as u32, index);
                let name = if *label == "Label_work" {
                    "Work"
                } else {
                    label
                };
                let label_type = if *label == "Label_work" {
                    "User"
                } else {
                    "System"
                };
                sqlx::query("INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type) VALUES ($1,$2,$3,$4,'Show','LabelShow',$5::email_label_type_enum)")
                    .bind(id).bind(link).bind(label).bind(name).bind(label_type)
                    .execute(db).await.expect("fixture label");
                let key = format!("{letter}/{label}");
                labels.insert(key.clone(), id);
                normalizer.symbol(id, format!("<label:{key}>"));
            }
            let thread_names: &[&str] = match inbox {
                0 => &world::THREADS,
                1 => &["b1"],
                _ => &["a2t"],
            };
            for (index, name) in thread_names.iter().enumerate() {
                let id = world::thread_uuid(shard + inbox as u32, index);
                normalizer.symbol(id, format!("<thread:{name}>"));
                sqlx::query("INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read) VALUES ($1,$2,$3,true,false)")
                    .bind(id).bind(name).bind(link).execute(db).await.expect("fixture thread");
            }
            let mut mailbox = match inbox {
                0 => world::MESSAGES.to_vec(),
                1 => vec![
                    ("b1a", "b1", &["INBOX", "UNREAD"] as &[&str]),
                    ("b1b", "b1", &["INBOX"]),
                ],
                _ => vec![
                    ("a2a", "a2t", &["INBOX", "UNREAD"] as &[&str]),
                    ("a2b", "a2t", &["INBOX"]),
                ],
            };
            if inbox == 0 {
                mailbox.push(("draft", "t1", &["INBOX"]));
            }
            for (index, (name, thread, initial_labels)) in mailbox.iter().enumerate() {
                let id = world::message_uuid(shard + inbox as u32, index);
                normalizer.symbol(id, format!("<msg:{name}>"));
                messages.insert(name.to_string(), id);
                let thread_index = thread_names
                    .iter()
                    .position(|t| t == thread)
                    .expect("thread index");
                let thread_id = world::thread_uuid(shard + inbox as u32, thread_index);
                let provider_id = if *name == "draft" { None } else { Some(*name) };
                sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,provider_id,provider_thread_id,is_read,is_starred,is_sent,is_draft,has_attachments,internal_date_ts) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,false,to_timestamp($9::double precision/1000))")
                    .bind(id).bind(thread_id).bind(link).bind(provider_id).bind(thread)
                    .bind(!initial_labels.contains(&"UNREAD")).bind(initial_labels.contains(&"STARRED"))
                    .bind(*name == "draft").bind((1_790_000_000_000_i64 + index as i64 * 60_000) as f64)
                    .execute(db).await.expect("fixture message");
                for label in *initial_labels {
                    sqlx::query(
                        "INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2)",
                    )
                    .bind(id)
                    .bind(labels[&format!("{letter}/{label}")])
                    .execute(db)
                    .await
                    .expect("fixture message label");
                }
                if inbox != 0 {
                    gmail.messages.insert(
                        name.to_string(),
                        GmailMessage {
                            thread_id: thread.to_string(),
                            labels: initial_labels.iter().map(|v| v.to_string()).collect(),
                            internal_date_ms: 1_790_000_000_000 + index as i64 * 60_000,
                        },
                    );
                }
            }
            for index in 0..thread_names.len() {
                let mut connection = db.acquire().await.expect("fixture connection");
                email_db_client::threads::update::update_thread_metadata(
                    &mut connection,
                    world::thread_uuid(shard + inbox as u32, index),
                    *link,
                )
                .await
                .expect("fixture thread metadata");
            }
        }
        sqlx::query("INSERT INTO macro_user_links (primary_macro_id,child_macro_id,link_id) VALUES ($1,$2,$3)")
            .bind(&users[0]).bind(&users[1]).bind(links[1]).execute(db).await.expect("delegation");
        Self {
            links,
            messages,
            labels,
            users,
            fusion,
            gmail,
        }
    }
}
