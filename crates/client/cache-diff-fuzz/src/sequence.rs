//! Generates one operation sequence from a seed. The sequence is fixed before
//! it runs: every response the engine is given is materialized here, and the
//! few ops that need an engine answer (a lease, a cursor, the last page's keys)
//! name it by position, so both builds replay the same requests and an op can be
//! dropped from a sequence (to minimize a case) without changing the others.

use crate::faker::{BodyProfile, Faker, ItemSpec, Plan, rfc3339};
use crate::rng::{Rng, mix, words};
use apollo_compiler::schema::{ExtendedType, Type};
use apollo_compiler::{ExecutableDocument, Name};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

mod filters;
mod people;
mod queue;

pub const NOW_MS: i64 = 1_795_000_000_000;
const DAY_MS: i64 = 86_400_000;
pub const NIL: &str = "00000000-0000-0000-0000-000000000000";
pub const SOUP_DOCS: &[&str] = &[
    "SoupBackfill",
    "SoupMailBackfill",
    "ContactDirectoryBackfill",
    "Soup",
    "EmailThreadPage",
];

/// One request to the engine host, or a host event (idle, reopen, crash).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Op {
    /// A background page (`hydrateQuery`); `contacts` pages carry a fenced scope.
    Hydrate {
        lane: String,
        doc: String,
        variables: Map<String, Value>,
        data: Value,
        identity: String,
        contacts: bool,
    },
    /// A foreground network response (`write`), optionally registering `register`.
    Write {
        lane: String,
        doc: String,
        variables: Map<String, Value>,
        data: Value,
        identity: String,
        register: Option<String>,
    },
    /// `read` of a document, optionally registering an operation id.
    Read {
        doc: String,
        variables: Map<String, Value>,
        register: Option<String>,
    },
    Teardown {
        op_id: String,
    },
    /// `readRecordsByKeys`; `keys: None` reads the last filter page's keys.
    ReadKeys {
        fragment: String,
        keys: Option<Vec<String>>,
    },
    /// `entityFilter`, following `nextCursor` (Mail) for up to `pages` pages.
    Filter {
        request: Value,
        pages: u8,
    },
    /// A maintained view of a reconciled Soup filter (`entityFilter` with
    /// `liveQuery`), one of a few subscriber slots: `read` from scratch,
    /// `read-since` the slot's last revision, `resume` its registration
    /// (`resumeEntityFilter`), or `release` it.
    Live {
        slot: u8,
        action: String,
        request: Value,
    },
    /// Quick Access search, following its cursor for up to `pages` pages.
    Search {
        request: Value,
        pages: u8,
    },
    Enqueue {
        /// Position among this sequence's enqueues, named by later settlement ops.
        tx: usize,
        uuid: String,
        doc: String,
        variables: Map<String, Value>,
        data: Value,
        created_at_ms: i64,
        owner: String,
        now_ms: i64,
        lease_ms: i64,
    },
    Claim {
        owner: String,
        now_ms: i64,
        lease_ms: i64,
    },
    /// Settle the `tx`th enqueue with the lease the host last saw for it.
    Commit {
        tx: usize,
        doc: String,
        variables: Map<String, Value>,
        data: Value,
    },
    Rollback {
        tx: usize,
    },
    Defer {
        tx: usize,
        next_attempt_at_ms: i64,
        server_failure: bool,
    },
    InspectMutations,
    Delete {
        keys: Vec<String>,
    },
    Invalidate {
        keys: Vec<String>,
    },
    /// Contact snapshot (fence + scan) and reconcile with `present` of the scan.
    ContactReconcile {
        identity: String,
        keep_every: u8,
    },
    PeopleContext {
        identity: String,
        epoch: String,
    },
    PeopleSearch {
        identity: String,
        request: Value,
        pages: u8,
    },
    Clear,
    /// The host's idle point (the WAL checkpoint, in builds that have one).
    Idle,
    /// Close the engine and open the same file again.
    Reopen,
    /// Copy the files as they are, abandon the engine, and open the copy.
    Crash,
    /// A fixed battery of reads over everything the sequence wrote.
    Probe,
}

/// Entities by kind, as the server knows them now.
#[derive(Clone, Debug, Default)]
struct Pools {
    core: Vec<ItemSpec>,
    channels: Vec<ItemSpec>,
    threads: Vec<ItemSpec>,
    contacts: Vec<Contact>,
}

#[derive(Clone, Debug)]
struct Contact {
    /// An id the server made up instead of the viewer-scoped contact key; such a
    /// record never joins the people index.
    foreign: Option<String>,
    user: String,
    email: String,
    /// None sends `name: null`, which the index reads as the email's local part.
    name: Option<String>,
}

/// A page written earlier, which a refetch can repeat or change.
#[derive(Clone)]
struct Written {
    op: Op,
    lane: String,
    keys: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize)]
pub struct Generated {
    pub ops: Vec<Op>,
    /// Every id the generator made, which normalization keeps verbatim.
    pub ids: BTreeSet<String>,
    /// Keys a probe reads back, by fragment.
    pub probe_keys: BTreeMap<String, Vec<String>>,
    pub viewer: String,
}

pub struct Gen<'a> {
    faker: &'a Faker,
    docs: &'a BTreeMap<String, ExecutableDocument>,
    mail_tabs: &'a [(String, Value)],
    rng: Rng,
    viewer: String,
    links: Vec<String>,
    pools: Pools,
    ids: BTreeSet<String>,
    tie: bool,
    times: Vec<i64>,
    body: BodyProfile,
    clock: i64,
    written: Vec<Written>,
    enqueued: usize,
    uuids: Vec<String>,
    registered: Vec<String>,
    next_register: usize,
    /// Keys the sequence wrote that are no longer in the pools: deleted, dropped
    /// by the server, or only ever optimistic. The final probe reads them too.
    departed: Vec<String>,
    /// Input nodes one filter may still grow, so a deep, wide filter stays bounded.
    filter_budget: u32,
    /// Connectives a filter still nests before its first literal: a chain this
    /// long reaches the depth limits of the predicate index and of Turso's parser.
    filter_chain: u8,
    /// The filter each live view slot last read, so later reads of a slot
    /// mostly ask for the same view and get deltas.
    live: [Option<Value>; LIVE_SLOTS],
    ops: Vec<Op>,
}

const LIVE_SLOTS: usize = 3;

const LIMITS: &[u16] = &[1, 2, 3, 7, 20, 50, 63, 64, 65, 100, 128, 500];
const SORTS: &[(&str, u32)] = &[
    ("UPDATED_AT", 45),
    ("CREATED_AT", 35),
    ("VIEWED_UPDATED", 6),
    ("VIEWED_AT", 4),
    ("NOTIFIED_AT", 4),
    ("NAME", 4),
    ("PROPERTY", 2),
];
const PARTITIONS: &[(&str, &str)] = &[
    ("documentFilter", "GraphqlDocumentExpr"),
    ("projectFilter", "GraphqlProjectExpr"),
    ("chatFilter", "GraphqlChatExpr"),
    ("channelFilter", "GraphqlChannelExpr"),
    ("emailFilter", "GraphqlEmailFilterAst"),
    ("channelThreadFilter", "GraphqlChannelThreadExpr"),
    ("calendarEventFilter", "GraphqlCalendarEventExpr"),
    ("callFilter", "GraphqlCallExpr"),
    ("crmCompanyFilter", "GraphqlCrmCompanyExpr"),
    ("foreignEntityFilter", "GraphqlForeignEntityExpr"),
];
const MAIL_VIEWS: &[&str] = &[
    "INBOX",
    "ALL",
    "DRAFTS",
    "SENT",
    "STARRED",
    "IMPORTANT",
    "OTHER",
];

fn exclusion(partition: &str) -> Value {
    match partition {
        "documentFilter" | "calendarEventFilter" | "crmCompanyFilter" | "foreignEntityFilter" => {
            json!({"literal": {"id": NIL}})
        }
        "projectFilter" => json!({"literal": {"projectIdSelf": NIL}}),
        "chatFilter" => json!({"literal": {"chatId": NIL}}),
        "emailFilter" => json!({"tree": {"literal": {"threadId": NIL}}}),
        "channelFilter" => json!({"literal": {"channelId": NIL}}),
        "channelThreadFilter" => json!({"literal": {"threadId": NIL}}),
        _ => json!({"literal": {"callId": NIL}}),
    }
}

/// Filters excluding every partition but `except`, as the backfill lanes send.
pub fn excluded(except: &[&str]) -> Value {
    Value::Object(
        PARTITIONS
            .iter()
            .filter(|(name, _)| !except.contains(name))
            .map(|(name, _)| ((*name).to_owned(), exclusion(name)))
            .collect(),
    )
}

fn pick<'v, T>(rng: &mut Rng, values: &'v [T]) -> &'v T {
    &values[rng.below(values.len() as u64) as usize]
}

fn weighted<'v>(rng: &mut Rng, values: &'v [(&'v str, u32)]) -> &'v str {
    let total: u32 = values.iter().map(|(_, weight)| weight).sum();
    let mut roll = rng.below(u64::from(total)) as u32;
    for (value, weight) in values {
        if roll < *weight {
            return value;
        }
        roll -= weight;
    }
    values[0].0
}

impl<'a> Gen<'a> {
    pub fn new(
        faker: &'a Faker,
        docs: &'a BTreeMap<String, ExecutableDocument>,
        mail_tabs: &'a [(String, Value)],
        seed: u64,
    ) -> Self {
        let mut rng = Rng::new(mix(seed, "diff-fuzz"));
        let viewer_uuid = rng.uuid();
        let viewer = format!("macro|{viewer_uuid}@example.com");
        let links = vec![rng.uuid(), rng.uuid()];
        let tie = rng.chance(0.45);
        let distinct = if tie {
            *pick(&mut rng, &[1, 2, 3, 8])
        } else {
            0
        };
        let times = (0..distinct).map(|index| NOW_MS - index * DAY_MS).collect();
        let body = if rng.chance(0.2) {
            BodyProfile {
                html_median: 18_000.0,
                text_median: 2_500.0,
            }
        } else {
            BodyProfile {
                html_median: 700.0,
                text_median: 200.0,
            }
        };
        let mut ids = BTreeSet::new();
        ids.insert(viewer_uuid);
        ids.insert(viewer.clone());
        ids.extend(links.iter().cloned());
        let mut generator = Self {
            faker,
            docs,
            mail_tabs,
            rng,
            viewer,
            links,
            pools: Pools::default(),
            ids,
            tie,
            times,
            body,
            clock: NOW_MS,
            written: Vec::new(),
            enqueued: 0,
            uuids: Vec::new(),
            registered: Vec::new(),
            next_register: 0,
            departed: Vec::new(),
            filter_budget: 0,
            filter_chain: 0,
            live: Default::default(),
            ops: Vec::new(),
        };
        let scale = *pick(&mut generator.rng, &[0usize, 1, 1, 2, 2, 3]);
        let core = [30, 90, 220, 650][scale];
        let channels = [5, 20, 50, 120][scale];
        let threads = [25, 110, 300, 900][scale];
        let contacts = [10, 60, 250, 700][scale];
        for (typename, share) in [
            ("GraphqlSoupDocument", 6),
            ("GraphqlSoupChat", 3),
            ("GraphqlSoupProject", 1),
        ] {
            for _ in 0..core * share / 10 {
                let spec = generator.spec(typename);
                generator.pools.core.push(spec);
            }
        }
        for _ in 0..channels {
            let spec = generator.spec("GraphqlSoupChannel");
            generator.pools.channels.push(spec);
        }
        for _ in 0..threads {
            let mut spec = generator.spec("GraphqlSoupEmailThread");
            spec.messages = generator.rng.range(1, 6) as usize;
            generator.pools.threads.push(spec);
        }
        for _ in 0..contacts {
            let contact = generator.contact();
            generator.pools.contacts.push(contact);
        }
        generator
    }

    fn time(&mut self) -> i64 {
        if self.times.is_empty() {
            NOW_MS - self.rng.below(120 * DAY_MS as u64) as i64
        } else {
            *pick(&mut self.rng, &self.times)
        }
    }

    fn spec(&mut self, typename: &str) -> ItemSpec {
        let id = self.rng.uuid();
        self.ids.insert(id.clone());
        ItemSpec {
            typename: typename.to_owned(),
            id,
            time_ms: self.time(),
            messages: 0,
            revision: 0,
        }
    }

    fn contact(&mut self) -> Contact {
        let foreign = self.rng.chance(0.1).then(|| self.rng.uuid());
        if let Some(id) = &foreign {
            self.ids.insert(id.clone());
        }
        let words_count = self.rng.range(1, 3) as usize;
        let name = (!self.rng.chance(0.1)).then(|| words(&mut self.rng, words_count));
        let local = format!("{}.{}", words(&mut self.rng, 1), self.rng.below(1000))
            .replace([' ', '\u{0}', '\t', ',', ':', '\''], "")
            .to_lowercase();
        let local = if local.is_ascii() && !local.is_empty() {
            local
        } else {
            format!("u{}", self.rng.below(100_000))
        };
        let domain = *pick(
            &mut self.rng,
            &["example.com", "acme.io", "mail.example.org"],
        );
        let email = format!("{local}@{domain}");
        let user = format!("macro|{email}");
        // The record's email may differ from the user id's in case only.
        let email = if self.rng.chance(0.05) {
            email.to_uppercase()
        } else {
            email
        };
        Contact {
            foreign,
            user,
            email,
            name,
        }
    }

    fn plan<'p>(&'p self, items: &'p [ItemSpec], focus: Option<&'p ItemSpec>) -> Plan<'p> {
        Plan {
            items,
            focus,
            viewer_id: &self.viewer,
            link_ids: &self.links,
            body: self.body,
            revision: 0,
            tie: self.tie,
        }
    }

    fn response(&mut self, doc: &str, items: &[ItemSpec], focus: Option<&ItemSpec>) -> Value {
        let seed = self.rng.next_u64();
        let plan = self.plan(items, focus);
        let mut data = self.faker.response(&self.docs[doc], &plan, seed);
        data["data"].take()
    }

    fn tick(&mut self) -> i64 {
        self.clock += self.rng.range(1, 90_000) as i64;
        self.clock
    }

    fn push(&mut self, op: Op) {
        self.ops.push(op);
    }

    pub fn generate(mut self, length: usize) -> Generated {
        // Backfill first, as the app does on a fresh cache.
        // Most caches finish the metadata lanes; some stop partway.
        for lane in [
            "channels",
            "core-entities",
            "email-filter-metadata",
            "email-thread-pages",
        ] {
            let per_page = if lane == "email-thread-pages" { 5 } else { 100 };
            let all = self.lane_pool(lane).len().div_ceil(per_page).max(1) as u64;
            let pages = if lane != "email-thread-pages" && self.rng.chance(0.8) {
                all
            } else {
                self.rng.range(1, 3).min(all)
            };
            for page in 0..pages {
                self.hydrate_lane(lane, page as usize);
            }
        }
        if self.rng.chance(0.6) {
            self.people_backfill();
        }
        while self.ops.len() < length {
            self.step();
            if self.rng.chance(0.3) {
                self.push(Op::Idle);
            }
        }
        self.push(Op::Idle);
        self.push(Op::Probe);
        let mut probe_keys: BTreeMap<String, Vec<String>> = BTreeMap::new();
        // Contacts are not Soup items (the engine skips them by type here); the
        // people probes and the table dump check them.
        let soup: Vec<String> = self
            .pools
            .core
            .iter()
            .chain(&self.pools.channels)
            .chain(&self.pools.threads)
            .map(|spec| format!("{}:{}", spec.typename, spec.id))
            .chain(self.departed.iter().cloned())
            .collect();
        let mail: Vec<String> = self
            .pools
            .threads
            .iter()
            .map(|spec| format!("{}:{}", spec.typename, spec.id))
            .chain(
                self.departed
                    .iter()
                    .filter(|key| key.starts_with("GraphqlSoupEmailThread:"))
                    .cloned(),
            )
            .collect();
        let mut seen = BTreeSet::new();
        let soup: Vec<String> = soup
            .into_iter()
            .filter(|key| seen.insert(key.clone()))
            .collect();
        let mut seen = BTreeSet::new();
        let mail: Vec<String> = mail
            .into_iter()
            .filter(|key| seen.insert(key.clone()))
            .collect();
        probe_keys.insert("SoupItemFields".into(), soup);
        probe_keys.insert("MailItemFields".into(), mail);
        Generated {
            ops: self.ops,
            ids: self.ids,
            probe_keys,
            viewer: self.viewer,
        }
    }

    fn step(&mut self) {
        const KINDS: &[(&str, u32)] = &[
            ("hydrate", 12),
            ("refetch-same", 6),
            ("refetch-delta", 9),
            ("home", 4),
            ("thread", 4),
            ("contacts", 3),
            ("contact-reconcile", 1),
            ("people-context", 1),
            ("people-search", 3),
            ("enqueue", 7),
            ("claim", 3),
            ("commit", 4),
            ("rollback", 2),
            ("defer", 1),
            ("inspect", 1),
            ("delete", 2),
            ("invalidate", 1),
            ("soup-filter", 14),
            ("live", 6),
            ("deep-window", 2),
            ("mail-filter", 10),
            ("read-keys", 4),
            ("read", 3),
            ("teardown", 1),
            ("search", 7),
            ("reopen", 2),
            ("crash", 2),
            ("clear", 1),
            ("identity", 1),
            ("malformed", 2),
        ];
        match weighted(&mut self.rng, KINDS) {
            "hydrate" => {
                let lane = *pick(
                    &mut self.rng,
                    &[
                        "channels",
                        "core-entities",
                        "email-filter-metadata",
                        "email-thread-pages",
                    ],
                );
                let page = self.rng.below(4) as usize;
                self.hydrate_lane(lane, page);
            }
            "refetch-same" => {
                if let Some(written) = self.pick_written() {
                    self.push(written.op);
                }
            }
            "refetch-delta" => self.refetch_delta(),
            "malformed" => self.malformed(),
            "home" => self.home(),
            "thread" => self.thread(),
            "contacts" => {
                let page = self.rng.below(3) as usize;
                self.contacts_page(page);
            }
            "contact-reconcile" => {
                let keep_every = self.rng.range(1, 4) as u8;
                self.push(Op::ContactReconcile {
                    identity: self.viewer.clone(),
                    keep_every,
                });
            }
            "people-context" => self.people_context(),
            "people-search" => self.people_search(),
            "enqueue" => self.enqueue(),
            "claim" => {
                let owner = pick(&mut self.rng, &["runner-a", "runner-b"]).to_string();
                let now_ms = self.tick();
                let lease_ms = *pick(&mut self.rng, &[1_000, 60_000, 600_000]);
                self.push(Op::Claim {
                    owner,
                    now_ms,
                    lease_ms,
                });
            }
            "commit" => self.commit(),
            "rollback" => {
                if let Some(tx) = self.pick_tx() {
                    self.push(Op::Rollback { tx });
                }
            }
            "defer" => {
                if let Some(tx) = self.pick_tx() {
                    let next_attempt_at_ms = self.tick() + 5_000;
                    let server_failure = self.rng.chance(0.5);
                    self.push(Op::Defer {
                        tx,
                        next_attempt_at_ms,
                        server_failure,
                    });
                }
            }
            "inspect" => self.push(Op::InspectMutations),
            "delete" => {
                let keys = self.some_keys(8);
                self.forget(&keys);
                self.push(Op::Delete { keys });
            }
            "invalidate" => {
                let keys = self.some_keys(8);
                self.push(Op::Invalidate { keys });
            }
            "soup-filter" => {
                let request = self.soup_filter();
                self.push(Op::Filter { request, pages: 1 });
                if self.rng.chance(0.4) {
                    self.push(Op::ReadKeys {
                        fragment: "SoupItemFields".into(),
                        keys: None,
                    });
                }
            }
            "live" => self.live(),
            "deep-window" => self.deep_window(),
            "mail-filter" => {
                let request = self.mail_filter();
                let pages = *pick(&mut self.rng, &[1u8, 2, 3, 8, 40]);
                self.push(Op::Filter { request, pages });
                if self.rng.chance(0.4) {
                    self.push(Op::ReadKeys {
                        fragment: "MailItemFields".into(),
                        keys: None,
                    });
                }
            }
            "read-keys" => {
                let fragment =
                    pick(&mut self.rng, &["SoupItemFields", "MailItemFields"]).to_string();
                let keys = self.some_keys(60);
                self.push(Op::ReadKeys {
                    fragment,
                    keys: Some(keys),
                });
            }
            "read" => self.read(),
            "teardown" => {
                if !self.registered.is_empty() {
                    let index = self.rng.below(self.registered.len() as u64) as usize;
                    let op_id = self.registered.remove(index);
                    self.push(Op::Teardown { op_id });
                }
            }
            "search" => {
                let request = self.search();
                let pages = *pick(&mut self.rng, &[1u8, 1, 2, 4]);
                self.push(Op::Search { request, pages });
            }
            "reopen" => {
                self.push(Op::Reopen);
                self.push(Op::Probe);
            }
            "crash" => {
                self.push(Op::Crash);
                self.push(Op::Probe);
            }
            "clear" => {
                self.push(Op::Clear);
                self.written.clear();
                if self.rng.chance(0.6) {
                    self.people_backfill();
                }
            }
            _ => {
                // Another account signs in: the app clears the cache first.
                self.push(Op::Clear);
                let uuid = self.rng.uuid();
                self.viewer = format!("macro|{uuid}@example.com");
                self.ids.insert(uuid);
                self.ids.insert(self.viewer.clone());
                self.written.clear();
                self.home();
                if self.rng.chance(0.6) {
                    self.people_backfill();
                }
            }
        }
    }

    /// A written page again with one value broken (see `malformed.rs`). The
    /// write normalizes it twice where it used to, so both builds must answer
    /// with the same error, or write the same records.
    fn malformed(&mut self) {
        let Some(written) = self.pick_written() else {
            return;
        };
        let mut op = written.op;
        let (Op::Hydrate { data, .. } | Op::Write { data, .. }) = &mut op else {
            return;
        };
        let choice = self.rng.below(u64::MAX);
        crate::malformed::break_one(data, choice);
        self.push(op);
    }

    fn pick_written(&mut self) -> Option<Written> {
        if self.written.is_empty() {
            return None;
        }
        let index = self.rng.below(self.written.len() as u64) as usize;
        Some(self.written[index].clone())
    }

    fn pick_tx(&mut self) -> Option<usize> {
        (self.enqueued > 0).then(|| {
            // Mostly the recent ones, which are the ones still pending.
            let back = self.rng.below(3.min(self.enqueued as u64)) as usize;
            self.enqueued - 1 - back
        })
    }

    fn lane_pool(&mut self, lane: &str) -> &mut Vec<ItemSpec> {
        match lane {
            "channels" => &mut self.pools.channels,
            "core-entities" | "home" => &mut self.pools.core,
            _ => &mut self.pools.threads,
        }
    }

    fn hydrate_lane(&mut self, lane: &str, page: usize) {
        let (doc, limit, except, sort): (&str, usize, &[&str], &str) = match lane {
            "channels" => ("SoupBackfill", 100, &["channelFilter"], "VIEWED_UPDATED"),
            "core-entities" => (
                "SoupBackfill",
                100,
                &["documentFilter", "projectFilter", "chatFilter"],
                "VIEWED_UPDATED",
            ),
            "email-filter-metadata" => ("SoupMailBackfill", 100, &["emailFilter"], "UPDATED_AT"),
            _ => ("SoupBackfill", 5, &["emailFilter"], "UPDATED_AT"),
        };
        let mut pool = self.lane_pool(lane).clone();
        pool.sort_by_key(|spec| std::cmp::Reverse(spec.time_ms));
        let start = (page * limit).min(pool.len());
        let end = (start + limit).min(pool.len());
        let items = pool[start..end].to_vec();
        let more = end < pool.len();
        let variables = if page == 0 {
            json!({ "input": { "initial": {
                "limit": limit, "expand": true, "sortMethod": sort, "emailView": "ALL",
                "filters": excluded(except),
            } } })
        } else {
            json!({ "input": { "continuation": { "cursor": format!("{lane}:{page}") } } })
        };
        let next = more.then(|| format!("{lane}:{}", page + 1));
        self.page(lane, doc, variables, items, next, false);
    }

    fn page(
        &mut self,
        lane: &str,
        doc: &str,
        variables: Value,
        items: Vec<ItemSpec>,
        next: Option<String>,
        write: bool,
    ) {
        let mut data = self.response(doc, &items, None);
        if let Some(soup) = data["user"]["soup"].as_object_mut() {
            soup.insert("nextCursor".into(), next.map_or(Value::Null, Value::String));
        }
        let variables = variables.as_object().cloned().unwrap_or_default();
        let op = if write {
            let register = self.rng.chance(0.3).then(|| self.register());
            Op::Write {
                lane: lane.to_owned(),
                doc: doc.to_owned(),
                variables,
                data,
                identity: self.viewer.clone(),
                register,
            }
        } else {
            Op::Hydrate {
                lane: lane.to_owned(),
                doc: doc.to_owned(),
                variables,
                data,
                identity: self.viewer.clone(),
                contacts: false,
            }
        };
        let keys = items
            .iter()
            .map(|spec| (spec.typename.clone(), spec.id.clone()))
            .collect();
        self.written.push(Written {
            op: op.clone(),
            lane: lane.to_owned(),
            keys,
        });
        self.push(op);
    }

    fn register(&mut self) -> String {
        self.next_register += 1;
        let id = format!("client:{}", self.next_register);
        self.registered.push(id.clone());
        id
    }

    /// The server's copies changed: some entities have new values, some moved in
    /// time, some left the list and new ones joined. Refetch a written page.
    fn refetch_delta(&mut self) {
        let Some(written) = self.pick_written() else {
            return;
        };
        let lane = written.lane.clone();
        let changed_share = *pick(&mut self.rng, &[0.0, 0.05, 0.2, 1.0]);
        let move_share = *pick(&mut self.rng, &[0.0, 0.0, 0.1, 0.5]);
        let drop_one = self.rng.chance(0.25);
        let add = self.rng.chance(0.25);
        let ids: BTreeSet<String> = written.keys.iter().map(|(_, id)| id.clone()).collect();
        let mut times = Vec::new();
        for _ in 0..written.keys.len() {
            times.push((
                self.rng.chance(changed_share),
                self.rng.chance(move_share),
                self.time(),
            ));
        }
        let pool = self.lane_pool(&lane);
        for (index, spec) in pool
            .iter_mut()
            .filter(|spec| ids.contains(&spec.id))
            .enumerate()
        {
            let (change, moved, time) = times[index.min(times.len() - 1)];
            if change {
                spec.revision += 1;
            }
            if moved {
                spec.time_ms = time;
                spec.revision += 1;
            }
        }
        let dropped = match pool.iter().position(|spec| ids.contains(&spec.id)) {
            Some(position) if drop_one => {
                let spec = pool.remove(position);
                Some(format!("{}:{}", spec.typename, spec.id))
            }
            _ => None,
        };
        let typename = pool.first().map(|spec| spec.typename.clone());
        self.departed.extend(dropped);
        if add && let Some(typename) = typename {
            let mut spec = self.spec(&typename);
            spec.messages = 2;
            self.lane_pool(&lane).push(spec);
        }
        let (doc, variables) = match &written.op {
            Op::Hydrate { doc, variables, .. } | Op::Write { doc, variables, .. } => {
                (doc.clone(), Value::Object(variables.clone()))
            }
            _ => return,
        };
        let mut items: Vec<ItemSpec> = self
            .lane_pool(&lane)
            .iter()
            .filter(|spec| ids.contains(&spec.id))
            .cloned()
            .collect();
        if add && let Some(spec) = self.lane_pool(&lane).last().cloned() {
            items.insert(0, spec);
        }
        if lane == "thread-open" {
            if let Some(focus) = items.first().cloned() {
                self.thread_with(focus, variables);
            }
            return;
        }
        let next = match &written.op {
            Op::Hydrate { data, .. } | Op::Write { data, .. } => data["user"]["soup"]["nextCursor"]
                .as_str()
                .map(str::to_owned),
            _ => None,
        };
        let write = matches!(written.op, Op::Write { .. });
        self.page(&lane, &doc, variables, items, next, write);
    }

    fn home(&mut self) {
        let mut pool = self.pools.core.clone();
        pool.sort_by_key(|spec| std::cmp::Reverse(spec.time_ms));
        let limit = *pick(&mut self.rng, &[20usize, 50]);
        pool.truncate(limit);
        let variables = json!({ "input": { "initial": {
            "limit": limit, "expand": true, "sortMethod": "VIEWED_UPDATED", "emailView": "ALL",
        } } });
        self.page("home", "Soup", variables, pool, Some("home:1".into()), true);
    }

    fn thread(&mut self) {
        if self.pools.threads.is_empty() {
            return;
        }
        let focus = pick(&mut self.rng, &self.pools.threads).clone();
        let variables = json!({ "threadId": focus.id, "offset": 0, "limit": 20 });
        self.thread_with(focus, variables);
    }

    fn thread_with(&mut self, focus: ItemSpec, variables: Value) {
        let data = self.response("EmailThreadPage", &[], Some(&focus));
        let register = self.rng.chance(0.3).then(|| self.register());
        let op = Op::Write {
            lane: "thread-open".into(),
            doc: "EmailThreadPage".into(),
            variables: variables.as_object().cloned().unwrap_or_default(),
            data,
            identity: self.viewer.clone(),
            register,
        };
        self.written.push(Written {
            op: op.clone(),
            lane: "thread-open".into(),
            keys: vec![(focus.typename.clone(), focus.id.clone())],
        });
        self.push(op);
    }

    fn some_keys(&mut self, max: u64) -> Vec<String> {
        let count = self.rng.range(1, max) as usize;
        let all: Vec<String> = self
            .pools
            .core
            .iter()
            .chain(&self.pools.channels)
            .chain(&self.pools.threads)
            .map(|spec| format!("{}:{}", spec.typename, spec.id))
            .collect();
        if all.is_empty() {
            return vec![];
        }
        (0..count)
            .map(|_| pick(&mut self.rng, &all).clone())
            .collect()
    }

    /// Deleted keys leave the server too, so later pages stop carrying them.
    fn forget(&mut self, keys: &[String]) {
        let keys: BTreeSet<&String> = keys.iter().collect();
        self.departed.extend(
            keys.iter()
                .filter(|key| !key.starts_with("GraphqlContact:"))
                .map(|key| (*key).clone()),
        );
        for pool in [
            &mut self.pools.core,
            &mut self.pools.channels,
            &mut self.pools.threads,
        ] {
            pool.retain(|spec| !keys.contains(&format!("{}:{}", spec.typename, spec.id)));
        }
        let contacts = std::mem::take(&mut self.pools.contacts);
        for contact in contacts {
            let key = format!("GraphqlContact:{}", self.contact_id(&contact));
            if !keys.contains(&key) {
                self.pools.contacts.push(contact);
            }
        }
    }

    fn read(&mut self) {
        let register = self.rng.chance(0.4).then(|| self.register());
        if self.rng.chance(0.5)
            && let Some(written) = self.pick_written()
            && let Op::Hydrate { doc, variables, .. } | Op::Write { doc, variables, .. } =
                written.op
        {
            self.push(Op::Read {
                doc,
                variables,
                register,
            });
            return;
        }
        if self.pools.threads.is_empty() {
            return;
        }
        let thread = pick(&mut self.rng, &self.pools.threads).id.clone();
        let variables = json!({ "threadId": thread, "offset": 0, "limit": 20 });
        self.push(Op::Read {
            doc: "EmailThreadPage".into(),
            variables: variables.as_object().cloned().unwrap_or_default(),
            register,
        });
    }
}

pub fn load_docs(
    faker: &Faker,
    sources: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, ExecutableDocument>, rootcause::Report> {
    SOUP_DOCS
        .iter()
        .map(|name| {
            let source = sources
                .get(*name)
                .ok_or_else(|| rootcause::report!("docs.json lacks {name}"))?;
            Ok(((*name).to_owned(), faker.parse(source)?))
        })
        .collect()
}
