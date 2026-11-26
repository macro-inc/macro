//! Fuzz of what live views send over nested rows: channels with participant
//! lists, an optional latest message and notification records that writes
//! change, add, remove and reorder. Readers apply each delta as the page does,
//! sometimes from a stale revision so a retained view resets, and must always
//! show what a newly registered view reads.
//!
//! Each delta must also be exactly the one the page contract asks for, given
//! what the reader showed and what a new view reads. `CACHE_FUZZ_TRACE=<file>`
//! writes every delta, without its random ids, so two builds can be compared
//! byte for byte on the same seeds.
use super::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const VIEWER: &str = "macro|native@example.com";
const CHANNELS: u16 = 30;
const STEPS: usize = 300;
const USERS: u64 = 8;
const ROLES: [&str; 3] = ["owner", "member", "guest"];
const STATES: [&str; 3] = ["UNSEEN", "SEEN", "DONE"];
const FRAGMENT: &str = "fragment Item on GraphqlSoupChannel { id channelName: name updatedAt \
    participants { userId role leftAt } \
    latestMessage { messageId content mentions deletedAt } \
    notifications { id state } }";

fn id(n: u64) -> String {
    format!("00000000-0000-0000-0000-{n:012}")
}

/// xorshift64*: deterministic, so a failing seed replays.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[derive(Clone)]
struct Participant {
    user: u64,
    role: u64,
    left: bool,
}

#[derive(Clone)]
struct Channel {
    name: u64,
    updated: u64,
    participants: Vec<Participant>,
    message: Option<(u64, u64, Vec<u64>, bool)>,
    /// Notification ids; their states live in `Fuzz::states`, shared by id.
    notifications: Vec<u64>,
    private: bool,
}

fn time(n: u64) -> String {
    format!("2025-01-{:02}T00:00:00Z", 1 + n % 28)
}

fn item(n: u16, channel: &Channel, states: &BTreeMap<u64, u64>) -> Value {
    let channel_id = id(u64::from(n));
    json!({
        "__typename": "GraphqlSoupChannel", "id": channel_id, "cacheProjection": null,
        "isFavorited": false, "displayName": format!("channel {}", channel.name),
        "name": format!("channel {}", channel.name), "channelType": if channel.private { "private" } else { "team" }, "ownerId": VIEWER,
        "teamId": null, "organizationId": null, "isParticipant": true,
        "createdAt": time(u64::from(n)), "updatedAt": time(channel.updated),
        "participants": channel.participants.iter().map(|p| { let role = ROLES[p.role as usize % 3]; json!({
            "channelId": channel_id, "userId": format!("macro|user-{}@example.com", p.user),
            "role": role, "joinedAt": time(1),
            "leftAt": p.left.then(|| time(2)),
        })}).collect::<Vec<_>>(),
        "latestMessage": channel.message.as_ref().map(|(message, content, mentions, deleted)| json!({
            "messageId": id(1_000 + message), "channelId": channel_id, "threadId": null,
            "senderId": VIEWER, "content": format!("message text {content}"),
            "createdAt": time(3), "updatedAt": time(4), "deletedAt": deleted.then(|| time(5)),
            "mentions": mentions.iter().map(|m| format!("mention-{m}")).collect::<Vec<_>>(),
        })),
        "notifications": channel.notifications.iter().map(|n| { let state = STATES[states[n] as usize % 3]; json!({
            "__typename": "GraphqlNotification", "id": id(2_000 + n),
            "state": state, "createdAt": time(*n),
        })}).collect::<Vec<_>>(),
    })
}

fn write(handle: &EngineHandle, items: Vec<Value>) -> WriteResultWire {
    block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: include_str!("channel.graphql").into(),
        operation_name: None,
        variables: Variables::new(),
        data: json!({"user": {"id": VIEWER, "soup": {"items": items}}}),
        identity: Some(VIEWER.into()),
    }))
    .unwrap()
}

fn members(ids: &[u16]) -> Value {
    match ids {
        [one] => json!({"literal": {"channelId": id(u64::from(*one))}}),
        _ => {
            let (left, right) = ids.split_at(ids.len().div_ceil(2));
            json!({"or": {"left": members(left), "right": members(right)}})
        }
    }
}

#[derive(Clone)]
struct View {
    id: String,
    members: Vec<u16>,
    /// Only team channels: a channel made private leaves the window.
    team_only: bool,
    revision: Option<String>,
    /// Revisions this view has accepted, to read from a stale one.
    seen: Vec<String>,
    keys: Vec<String>,
    rows: BTreeMap<String, Value>,
    identities: BTreeMap<String, Value>,
}

impl View {
    fn request(&self, id: &str, since: Option<&str>) -> EntityFilterRequest {
        let nil = id_nil();
        serde_json::from_value(json!({
            "filters": {
                "documentFilter": {"literal": {"id": nil}},
                "projectFilter": {"literal": {"projectIdSelf": nil}},
                "chatFilter": {"literal": {"chatId": nil}},
                "emailFilter": {"tree": {"literal": {"threadId": nil}}},
                "calendarEventFilter": {"literal": {"id": nil}},
                "channelFilter": if self.team_only {
                    json!({"and": {"left": members(&self.members), "right": {"literal": {"channelType": "TEAM"}}}})
                } else {
                    members(&self.members)
                },
                "channelThreadFilter": {"literal": {"threadId": nil}},
                "callFilter": {"literal": {"callId": nil}},
                "crmCompanyFilter": {"literal": {"id": nil}},
                "foreignEntityFilter": {"literal": {"id": nil}},
            },
            "sortMethod": "CREATED_AT", "sortDirection": "DESC", "limit": self.members.len(),
            "baseline": self.members.iter().filter(|_| !self.team_only).map(|n| json!({
                "key": format!("GraphqlSoupChannel:{}", id_of(*n)), "sortTimestamp": time(u64::from(*n)),
            })).collect::<Vec<_>>(),
            "liveQuery": {"id": id, "document": FRAGMENT, "fragmentName": "Item", "since": since},
        }))
        .unwrap()
    }

    /// Reads as `createPredicateQuery` does, applies the delta, and returns
    /// it without the ids that differ between runs.
    fn read(&mut self, handle: &EngineHandle, since: Option<String>) -> Value {
        let mut update = serde_json::to_value(
            block_on(handle.entity_filter(self.request(&self.id, since.as_deref()))).unwrap(),
        )
        .unwrap();
        assert_eq!(update["kind"], "live-query", "{update}");
        if update["reset"] == true {
            // The page refuses a reset that carries patches: they have no base row.
            assert_eq!(update["patches"], json!([]), "{update}");
            self.rows.clear();
            self.identities.clear();
        }
        for key in update["removed"].as_array().unwrap() {
            self.rows.remove(key.as_str().unwrap());
            self.identities.remove(key.as_str().unwrap());
        }
        for row in update["upserts"].as_array().unwrap() {
            let key = row["recordKey"].as_str().unwrap().to_owned();
            self.identities.insert(key.clone(), row["identity"].clone());
            self.rows.insert(key, row["record"].clone());
        }
        for patch in update["patches"].as_array().unwrap() {
            self.identities.insert(
                patch["recordKey"].as_str().unwrap().to_owned(),
                patch["identity"].clone(),
            );
            let record = self
                .rows
                .get_mut(patch["recordKey"].as_str().unwrap())
                .expect("patch has a base row");
            for field in patch["fields"].as_array().unwrap() {
                let mut target = &mut *record;
                for segment in field["path"].as_array().unwrap() {
                    target = match segment {
                        Value::String(name) => &mut target[name.as_str()],
                        index => &mut target[index.as_u64().unwrap() as usize],
                    };
                }
                *target = field["value"].clone();
            }
        }
        if let Some(keys) = update["keys"].as_array() {
            self.keys = keys
                .iter()
                .map(|key| key.as_str().unwrap().to_owned())
                .collect();
        }
        self.revision = update["revision"].as_str().map(str::to_owned);
        self.seen.extend(self.revision.clone());
        let fields = update.as_object_mut().unwrap();
        fields.remove("registrationId");
        fields.remove("observationId");
        update
    }

    fn shown(&self) -> Vec<(String, Option<Value>)> {
        self.keys
            .iter()
            .map(|key| (key.clone(), self.rows.get(key).cloned()))
            .collect()
    }
}

/// What a delta sends, in its own order, with removals as a set: the page
/// removes them before it applies anything else.
fn delta(update: &Value) -> Value {
    let mut removed: Vec<_> = update["removed"].as_array().unwrap().clone();
    removed.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    json!({
        "reset": update["reset"],
        "keys": update["keys"],
        "upserts": update["upserts"].as_array().unwrap().iter()
            .map(|row| json!([row["recordKey"], row["record"], row["identity"]])).collect::<Vec<_>>(),
        "patches": update["patches"].as_array().unwrap().iter()
            .map(|patch| json!([patch["recordKey"], patch["fields"], patch["identity"]])).collect::<Vec<_>>(),
        "removed": removed,
    })
}

/// The delta the page contract asks for, from what the reader showed and what
/// a new view reads: a read from any revision but the reader's last resets
/// and sends every row; otherwise new rows go whole and changed rows as
/// patches of the fields that changed, in key order. The order goes out
/// whenever it changed, and always with a reset.
fn expected(before: &View, reset: bool, now: &View) -> Value {
    let keys = (reset || before.keys != now.keys).then(|| now.keys.clone());
    if reset {
        return json!({
            "reset": true, "keys": keys,
            "upserts": now.rows.iter().map(|(key, row)| json!([key, row, now.identities[key]])).collect::<Vec<_>>(),
            "patches": [], "removed": [],
        });
    }
    let mut upserts = Vec::new();
    let mut patches = Vec::new();
    for (key, row) in &now.rows {
        let identity = &now.identities[key];
        match before.rows.get(key) {
            None => upserts.push(json!([key, row, identity])),
            Some(shown) if shown != row || &before.identities[key] != identity => {
                let mut fields = Vec::new();
                changed_fields(shown, row, &mut Vec::new(), &mut fields);
                patches.push(json!([key, fields, identity]));
            }
            Some(_) => {}
        }
    }
    let before = &before.rows;
    let now = &now.rows;
    let removed: Vec<_> = before
        .keys()
        .filter(|key| !now.contains_key(*key))
        .collect();
    json!({"reset": false, "keys": keys, "upserts": upserts, "patches": patches, "removed": removed})
}

/// The smallest replacements that turn `before` into `after`: fields of an
/// object that keeps its keys, and entries of a list whose ids stay in place.
fn changed_fields(before: &Value, after: &Value, path: &mut Vec<Value>, out: &mut Vec<Value>) {
    if before == after {
        return;
    }
    match (before, after) {
        (Value::Object(was), Value::Object(now)) if was.keys().all(|key| now.contains_key(key)) => {
            for (key, value) in now {
                path.push(json!(key));
                match was.get(key) {
                    Some(previous) => changed_fields(previous, value, path, out),
                    None => out.push(json!({"path": path.clone(), "value": value})),
                }
                path.pop();
            }
        }
        (Value::Array(was), Value::Array(now))
            if was.len() == now.len()
                && was.iter().zip(now).all(|(a, b)| a.get("id") == b.get("id")) =>
        {
            for (index, (a, b)) in was.iter().zip(now).enumerate() {
                path.push(json!(index));
                changed_fields(a, b, path, out);
                path.pop();
            }
        }
        _ => out.push(json!({"path": path.clone(), "value": after})),
    }
}

fn id_nil() -> String {
    id(0)
}

fn id_of(n: u16) -> String {
    id(u64::from(n))
}

struct Fuzz {
    rng: Rng,
    channels: Vec<Channel>,
    states: BTreeMap<u64, u64>,
    next_notification: u64,
}

impl Fuzz {
    fn participant(&mut self) -> Participant {
        Participant {
            user: self.rng.below(USERS),
            role: self.rng.below(3),
            left: self.rng.below(4) == 0,
        }
    }

    fn mutate(&mut self, n: usize) {
        let kind = self.rng.below(13);
        let rng = &mut self.rng;
        let channel = &mut self.channels[n];
        match kind {
            0 => channel.name = rng.below(50),
            1 => channel.updated = rng.below(28),
            2 => {
                let participant = Participant {
                    user: rng.below(USERS),
                    role: rng.below(3),
                    left: false,
                };
                let at = rng.below(channel.participants.len() as u64 + 1) as usize;
                channel.participants.insert(at, participant);
            }
            3 if !channel.participants.is_empty() => {
                let at = rng.below(channel.participants.len() as u64) as usize;
                channel.participants.remove(at);
            }
            4 if !channel.participants.is_empty() => {
                let at = rng.below(channel.participants.len() as u64) as usize;
                channel.participants[at].role = rng.below(3);
                channel.participants[at].left = rng.below(2) == 0;
            }
            5 if channel.participants.len() > 1 => channel.participants.reverse(),
            6 => {
                channel.message = (rng.below(3) != 0).then(|| {
                    (
                        rng.below(20),
                        rng.below(20),
                        (0..rng.below(3)).map(|_| rng.below(5)).collect(),
                        rng.below(5) == 0,
                    )
                })
            }
            7 => {
                if let Some(message) = channel.message.as_mut() {
                    message.1 = rng.below(20);
                    message.3 = rng.below(5) == 0;
                }
            }
            8 => {
                self.next_notification += 1;
                let notification = self.next_notification;
                self.states.insert(notification, 0);
                channel.notifications.push(notification);
            }
            9 if !channel.notifications.is_empty() => {
                let at = rng.below(channel.notifications.len() as u64) as usize;
                channel.notifications.remove(at);
            }
            10 if !channel.notifications.is_empty() => {
                // A notification record shared with whichever channels list it.
                let at = rng.below(channel.notifications.len() as u64) as usize;
                let notification = channel.notifications[at];
                *self.states.get_mut(&notification).unwrap() = rng.below(3);
            }
            12 => channel.private = !channel.private,
            11 if !channel.notifications.is_empty() => {
                // Another channel lists the same notification record.
                let notification = channel.notifications[0];
                let other = rng.below(self.channels.len() as u64) as usize;
                if !self.channels[other].notifications.contains(&notification) {
                    self.channels[other].notifications.push(notification);
                }
            }
            _ => {}
        }
    }

    fn items(&self, channels: &[usize]) -> Vec<Value> {
        channels
            .iter()
            .map(|n| item(*n as u16, &self.channels[*n], &self.states))
            .collect()
    }
}

fn run(seed: u64, trace: &mut String) -> (usize, usize, usize) {
    let mut fuzz = Fuzz {
        rng: Rng(seed),
        channels: Vec::new(),
        states: BTreeMap::new(),
        next_notification: 0,
    };
    for _ in 0..=CHANNELS {
        let participants = (0..fuzz.rng.below(4)).map(|_| fuzz.participant()).collect();
        fuzz.channels.push(Channel {
            name: fuzz.rng.below(50),
            updated: fuzz.rng.below(28),
            participants,
            message: None,
            notifications: Vec::new(),
            private: false,
        });
    }
    let handle = spawn_handle();
    // Half the channels exist at first; the rest enter views as writes create them.
    let first: Vec<usize> = (1..=CHANNELS as usize)
        .filter(|_| fuzz.rng.below(2) == 0)
        .collect();
    write(&handle, fuzz.items(&first));
    let mut views: Vec<View> = (0..4)
        .map(|view| {
            let mut members: Vec<u16> = (1..=CHANNELS).filter(|_| fuzz.rng.below(3) == 0).collect();
            if members.is_empty() {
                members.push(1);
            }
            View {
                id: format!("fuzz-{view}"),
                members,
                team_only: view % 2 == 1,
                revision: None,
                seen: Vec::new(),
                keys: Vec::new(),
                rows: BTreeMap::new(),
                identities: BTreeMap::new(),
            }
        })
        .collect();
    let (mut patches, mut resets, mut removed) = (0, 0, 0);
    for step in 0..STEPS {
        let changed: Vec<usize> = (0..1 + fuzz.rng.below(3))
            .map(|_| 1 + fuzz.rng.below(u64::from(CHANNELS)) as usize)
            .collect();
        for n in &changed {
            fuzz.mutate(*n);
        }
        write(&handle, fuzz.items(&changed));
        for view in views.iter_mut() {
            // A reader that lost its place reads from an older revision.
            let since = match fuzz.rng.below(10) {
                0 => None,
                1 if !view.seen.is_empty() => {
                    Some(view.seen[fuzz.rng.below(view.seen.len() as u64) as usize].clone())
                }
                _ => view.revision.clone(),
            };
            let before = view.clone();
            let expect_reset = since.is_none() || since != view.revision;
            let update = view.read(&handle, since);
            patches += update["patches"].as_array().unwrap().len();
            resets += usize::from(update["reset"] == true);
            trace.push_str(&format!("{seed} {step} {} {update}\n", view.id));
            let mut fresh = View {
                id: format!("fresh-{}-{step}", view.id),
                members: view.members.clone(),
                team_only: view.team_only,
                revision: None,
                seen: Vec::new(),
                keys: Vec::new(),
                rows: BTreeMap::new(),
                identities: BTreeMap::new(),
            };
            fresh.read(&handle, None);
            block_on(handle.entity_filter({
                let mut release = fresh.request(&fresh.id, None);
                if let Some(live) = release.live_query.as_mut() {
                    live.release = true;
                }
                release
            }))
            .unwrap();
            assert_eq!(
                delta(&update),
                expected(&before, expect_reset, &fresh),
                "seed {seed} step {step}: {} sent another delta",
                view.id
            );
            removed += update["removed"].as_array().unwrap().len();
            assert_eq!(
                view.shown(),
                fresh.shown(),
                "seed {seed} step {step}: {} differs from a new read",
                view.id
            );
        }
    }
    (patches, resets, removed)
}

#[test]
fn applied_live_deltas_over_nested_rows_show_what_a_new_read_shows() {
    let mut trace = String::new();
    let (mut patches, mut resets, mut removed) = (0, 0, 0);
    for seed in 1..=4u64 {
        let (p, r, m) = run(seed.wrapping_mul(0x5851_F42D_4C95_7F2D), &mut trace);
        patches += p;
        resets += r;
        removed += m;
    }
    // Patches and resets of retained views must both happen, or the fuzz
    // proves nothing about them.
    assert!(patches > 500, "{patches} row patches");
    assert!(resets > 100, "{resets} resets");
    assert!(removed > 20, "{removed} removed rows");
    if let Some(path) = std::env::var_os("CACHE_FUZZ_TRACE") {
        std::fs::write(path, &trace).unwrap();
    }
    eprintln!(
        "{patches} row patches, {resets} resets, {removed} removed rows, trace {} lines",
        trace.lines().count()
    );
}
