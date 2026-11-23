//! A production-shaped cache, as the app's own backfill lanes would fill it:
//! the same documents, page sizes and lane order as `queries/soup/backfill.ts`
//! and the contact directory backfill, with synthesized responses.

use crate::faker::{BodyProfile, Faker, ItemSpec, Plan};
use crate::rng::{Rng, mix};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Entity counts for one cache size.
#[derive(Clone, Copy, Debug)]
pub struct Tier {
    pub channels: usize,
    pub documents: usize,
    pub chats: usize,
    pub projects: usize,
    /// Threads whose first message page (with bodies) is cached.
    pub body_threads: usize,
    /// Threads with filter metadata only.
    pub metadata_threads: usize,
    pub mean_messages: f64,
    pub contacts: usize,
    pub body: BodyProfile,
}

pub fn tier(name: &str) -> Option<Tier> {
    let body = BodyProfile {
        html_median: 18_000.0,
        text_median: 2_500.0,
    };
    match name {
        // p50 and p90 are sized to production origin storage (14 MB and 371 MB on disk).
        "tiny" => Some(Tier {
            channels: 10,
            documents: 120,
            chats: 30,
            projects: 10,
            body_threads: 40,
            metadata_threads: 100,
            mean_messages: 2.5,
            contacts: 100,
            body,
        }),
        "p50" => Some(Tier {
            channels: 40,
            documents: 600,
            chats: 120,
            projects: 30,
            body_threads: 160,
            metadata_threads: 600,
            mean_messages: 2.5,
            contacts: 400,
            body,
        }),
        "p90" => Some(Tier {
            channels: 400,
            documents: 8_000,
            chats: 2_500,
            projects: 400,
            body_threads: 5_000,
            metadata_threads: 15_000,
            mean_messages: 2.5,
            contacts: 6_000,
            body,
        }),
        _ => None,
    }
}

/// Row fragments read back by key.
pub const FRAGMENTS: &[&str] = &["MailItemFields", "SoupItemFields"];

pub const DOCUMENTS: &[&str] = &[
    "SoupBackfill",
    "SoupMailBackfill",
    "ContactDirectoryBackfill",
    "Soup",
    "EmailThreadPage",
];

const NIL: &str = "00000000-0000-0000-0000-000000000000";
const NOW_MS: i64 = 1_795_000_000_000;
const DAY_MS: i64 = 86_400_000;
const PAGE_LIMIT: usize = 100;
const EMAIL_CONTENT_PAGE_LIMIT: usize = 5;
const CONTACT_PAGE_LIMIT: usize = 500;

fn excluded(except: &[&str]) -> Value {
    let all = [
        ("calendarEventFilter", json!({"literal": {"id": NIL}})),
        ("documentFilter", json!({"literal": {"id": NIL}})),
        ("projectFilter", json!({"literal": {"projectIdSelf": NIL}})),
        ("chatFilter", json!({"literal": {"chatId": NIL}})),
        (
            "emailFilter",
            json!({"tree": {"literal": {"threadId": NIL}}}),
        ),
        ("channelFilter", json!({"literal": {"channelId": NIL}})),
        ("channelThreadFilter", json!({"literal": {"threadId": NIL}})),
        ("callFilter", json!({"literal": {"callId": NIL}})),
        ("crmCompanyFilter", json!({"literal": {"id": NIL}})),
        ("foreignEntityFilter", json!({"literal": {"id": NIL}})),
    ];
    let map: serde_json::Map<String, Value> = all
        .into_iter()
        .filter(|(name, _)| !except.contains(name))
        .map(|(name, value)| (name.to_owned(), value))
        .collect();
    Value::Object(map)
}

/// Fixed identities every response shares.
pub struct Identity {
    pub viewer_id: String,
    pub link_ids: Vec<String>,
}

pub struct Entities {
    pub channels: Vec<ItemSpec>,
    pub core: Vec<ItemSpec>,
    pub threads: Vec<ItemSpec>,
    pub contacts: Vec<ItemSpec>,
}

fn specs(rng: &mut Rng, typename: &str, count: usize, span_days: i64) -> Vec<ItemSpec> {
    (0..count)
        .map(|index| ItemSpec {
            typename: typename.to_owned(),
            id: rng.uuid(),
            time_ms: NOW_MS - (index as i64 * span_days * DAY_MS) / count.max(1) as i64,
            messages: 0,
        })
        .collect()
}

pub fn entities(tier: &Tier, seed: u64) -> (Identity, Entities) {
    let mut rng = Rng::new(seed);
    let identity = Identity {
        // Macro user ids are `macro|<email>`; the people engine refuses anything else.
        viewer_id: format!("macro|{}@example.com", rng.uuid()),
        link_ids: vec![rng.uuid(), rng.uuid()],
    };
    let channels = specs(&mut rng, "GraphqlSoupChannel", tier.channels, 365);
    let mut core = specs(&mut rng, "GraphqlSoupDocument", tier.documents, 730);
    core.extend(specs(&mut rng, "GraphqlSoupChat", tier.chats, 365));
    core.extend(specs(&mut rng, "GraphqlSoupProject", tier.projects, 730));
    core.sort_by_key(|spec| std::cmp::Reverse(spec.time_ms));
    let thread_count = tier.body_threads.max(tier.metadata_threads);
    let mut threads = specs(&mut rng, "GraphqlSoupEmailThread", thread_count, 90);
    for thread in &mut threads {
        // Geometric message count with the tier's mean, capped like the backend.
        let p = 1.0 / tier.mean_messages;
        let mut count = 1;
        while count < 20 && !rng.chance(p) {
            count += 1;
        }
        thread.messages = count;
    }
    let contacts = specs(&mut rng, "GraphqlContact", tier.contacts, 1000);
    (
        identity,
        Entities {
            channels,
            core,
            threads,
            contacts,
        },
    )
}

/// One replayable cache request.
pub struct Op {
    pub lane: &'static str,
    pub op: &'static str,
    pub doc: &'static str,
    pub variables: Value,
    pub data: Value,
}

impl Op {
    pub fn to_json(&self) -> Value {
        json!({
            "lane": self.lane,
            "op": self.op,
            "doc": self.doc,
            "operationName": self.doc,
            "variables": self.variables,
            // The host takes the response's `data`, not its envelope.
            "data": self.data["data"],
        })
    }
}

fn soup_variables(lane: &str, page: usize, initial: Value) -> Value {
    if page == 0 {
        json!({ "input": { "initial": initial } })
    } else {
        json!({ "input": { "continuation": { "cursor": format!("{lane}:{page}") } } })
    }
}

fn with_cursor(mut data: Value, path: &[&str], next: Option<String>) -> Value {
    let mut node = &mut data["data"];
    for key in path {
        node = &mut node[*key];
    }
    if let Value::Object(map) = node {
        map.insert(
            "nextCursor".to_owned(),
            next.map_or(Value::Null, Value::String),
        );
    }
    data
}

#[expect(clippy::too_many_arguments, reason = "one lane's full description")]
fn soup_lane(
    faker: &Faker,
    documents: &BTreeMap<&str, apollo_compiler::ExecutableDocument>,
    identity: &Identity,
    tier: &Tier,
    lane: &'static str,
    doc: &'static str,
    items: &[ItemSpec],
    page_limit: usize,
    initial: Value,
    out: &mut dyn FnMut(Op) -> Result<(), rootcause::Report>,
) -> Result<(), rootcause::Report> {
    let pages = items.len().div_ceil(page_limit);
    for (page, chunk) in items.chunks(page_limit).enumerate() {
        let plan = Plan {
            items: chunk,
            focus: None,
            viewer_id: &identity.viewer_id,
            link_ids: &identity.link_ids,
            body: tier.body,
            revision: 0,
        };
        let data = faker.response(&documents[doc], &plan, mix(page as u64, lane));
        let next = (page + 1 < pages).then(|| format!("{lane}:{}", page + 1));
        out(Op {
            lane,
            op: "hydrate",
            doc,
            variables: soup_variables(lane, page, initial.clone()),
            data: with_cursor(data, &["user", "soup"], next),
        })?;
    }
    Ok(())
}

pub fn seed_ops(
    faker: &Faker,
    documents: &BTreeMap<&str, apollo_compiler::ExecutableDocument>,
    identity: &Identity,
    entities: &Entities,
    tier: &Tier,
    out: &mut dyn FnMut(Op) -> Result<(), rootcause::Report>,
) -> Result<(), rootcause::Report> {
    let lane_input = |limit: usize, sort: &str, except: &[&str]| {
        json!({
            "limit": limit,
            "expand": true,
            "sortMethod": sort,
            "emailView": "ALL",
            "filters": excluded(except),
        })
    };
    soup_lane(
        faker,
        documents,
        identity,
        tier,
        "channels",
        "SoupBackfill",
        &entities.channels,
        PAGE_LIMIT,
        lane_input(PAGE_LIMIT, "VIEWED_UPDATED", &["channelFilter"]),
        out,
    )?;
    soup_lane(
        faker,
        documents,
        identity,
        tier,
        "core-entities",
        "SoupBackfill",
        &entities.core,
        PAGE_LIMIT,
        lane_input(
            PAGE_LIMIT,
            "VIEWED_UPDATED",
            &["documentFilter", "projectFilter", "chatFilter"],
        ),
        out,
    )?;
    soup_lane(
        faker,
        documents,
        identity,
        tier,
        "email-filter-metadata",
        "SoupMailBackfill",
        &entities.threads[..tier.metadata_threads.min(entities.threads.len())],
        PAGE_LIMIT,
        lane_input(PAGE_LIMIT, "UPDATED_AT", &["emailFilter"]),
        out,
    )?;
    soup_lane(
        faker,
        documents,
        identity,
        tier,
        "email-thread-pages",
        "SoupBackfill",
        &entities.threads[..tier.body_threads.min(entities.threads.len())],
        EMAIL_CONTENT_PAGE_LIMIT,
        lane_input(EMAIL_CONTENT_PAGE_LIMIT, "UPDATED_AT", &["emailFilter"]),
        out,
    )?;
    let pages = entities.contacts.len().div_ceil(CONTACT_PAGE_LIMIT);
    for (page, chunk) in entities.contacts.chunks(CONTACT_PAGE_LIMIT).enumerate() {
        let plan = Plan {
            items: chunk,
            focus: None,
            viewer_id: &identity.viewer_id,
            link_ids: &identity.link_ids,
            body: tier.body,
            revision: 0,
        };
        let data = faker.response(
            &documents["ContactDirectoryBackfill"],
            &plan,
            mix(page as u64, "contacts"),
        );
        let next = (page + 1 < pages).then(|| format!("contacts:{}", page + 1));
        let after = (page > 0).then(|| format!("contacts:{page}"));
        out(Op {
            lane: "contacts",
            op: "hydrate",
            doc: "ContactDirectoryBackfill",
            variables: json!({ "limit": CONTACT_PAGE_LIMIT, "after": after }),
            data: with_cursor(data, &["user", "contacts"], next),
        })?;
    }
    Ok(())
}

/// Variants of the foreground workload: run `n` of a replay writes variant
/// `n % FOREGROUND_VARIANTS`, so consecutive runs change the rows they write
/// instead of rewriting identical bytes.
pub const FOREGROUND_VARIANTS: u64 = 4;

/// Network responses the foreground workload writes: a Home list refresh and
/// opened email threads.
pub fn foreground_ops(
    faker: &Faker,
    variant: u64,
    documents: &BTreeMap<&str, apollo_compiler::ExecutableDocument>,
    identity: &Identity,
    entities: &Entities,
    tier: &Tier,
    out: &mut dyn FnMut(Op) -> Result<(), rootcause::Report>,
) -> Result<(), rootcause::Report> {
    let home = &entities.core[..50.min(entities.core.len())];
    let plan = Plan {
        items: home,
        focus: None,
        viewer_id: &identity.viewer_id,
        link_ids: &identity.link_ids,
        body: tier.body,
        revision: variant,
    };
    let data = faker.response(&documents["Soup"], &plan, mix(variant, "home"));
    out(Op {
        lane: "home-refresh",
        op: "write",
        doc: "Soup",
        variables: json!({ "input": { "initial": {
            "limit": 50, "expand": true, "sortMethod": "VIEWED_UPDATED", "emailView": "ALL",
        } } }),
        data: with_cursor(data, &["user", "soup"], Some("home:1".to_owned())),
    })?;
    let opened = entities
        .threads
        .iter()
        .take(tier.body_threads)
        .step_by(37)
        .take(20);
    for thread in opened {
        let plan = Plan {
            items: &[],
            focus: Some(thread),
            viewer_id: &identity.viewer_id,
            link_ids: &identity.link_ids,
            body: tier.body,
            revision: variant,
        };
        let data = faker.response(
            &documents["EmailThreadPage"],
            &plan,
            mix(variant, &thread.id),
        );
        out(Op {
            lane: "thread-open",
            op: "write",
            doc: "EmailThreadPage",
            variables: json!({ "threadId": thread.id, "offset": 0, "limit": 20 }),
            data,
        })?;
    }
    Ok(())
}
