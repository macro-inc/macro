//! Differential fuzz of the unchanged-view proof on writes: one engine whose
//! readers read every live view again after each changing write (what the
//! page did before writes carried `unchangedViews`), and one whose readers
//! skip the views the write proved unchanged. After every write each view
//! must hold the same rows in the same order in both. Half the projects exist
//! only once a write creates them, and each view sends only part of its members
//! as server evidence, so writes bring entrants into windows.
use super::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const VIEWER: &str = "macro|native@example.com";
const PROJECTS: u16 = 24;
const STEPS: usize = 400;
const TIMES: [&str; 6] = [
    "2025-01-01T00:00:00Z",
    "2025-01-02T00:00:00Z",
    "2025-01-03T00:00:00Z",
    "2025-01-04T00:00:00Z",
    "2025-01-05T00:00:00Z",
    "2025-01-06T00:00:00Z",
];
const FRAGMENT: &str =
    "fragment Item on GraphqlSoupProject { id favorite: isFavorited updatedAt parentId }";

fn id(n: u16) -> String {
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
struct Project {
    favorite: bool,
    updated: usize,
    parent: Option<u16>,
}

fn item(n: u16, project: &Project) -> Value {
    json!({"__typename": "GraphqlSoupProject", "id": id(n), "cacheProjection": null,
        "ownerId": VIEWER, "parentId": project.parent.map(id), "createdAt": TIMES[0],
        "updatedAt": TIMES[project.updated], "notifications": [], "properties": [],
        "isFavorited": project.favorite})
}

fn write(handle: &EngineHandle, items: Vec<Value>) -> WriteResultWire {
    block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: include_str!("project.graphql").into(),
        operation_name: None,
        variables: Variables::new(),
        data: json!({"user": {"id": VIEWER, "soup": {"items": items}}}),
        identity: Some(VIEWER.into()),
    }))
    .unwrap()
}

fn members(ids: &[u16]) -> Value {
    match ids {
        [one] => json!({"literal": {"projectIdSelf": id(*one)}}),
        _ => {
            let (left, right) = ids.split_at(ids.len().div_ceil(2));
            json!({"or": {"left": members(left), "right": members(right)}})
        }
    }
}

struct View {
    id: String,
    members: Vec<u16>,
    /// The server evidence the view sends: some members, not all.
    baseline: Vec<u16>,
    limit: usize,
    revision: Option<String>,
    observation: Option<String>,
    keys: Vec<String>,
    rows: BTreeMap<String, Value>,
}

impl View {
    fn request(&self) -> EntityFilterRequest {
        let nil = id(0);
        serde_json::from_value(json!({
            "filters": {
                "documentFilter": {"literal": {"id": nil}},
                "projectFilter": members(&self.members),
                "chatFilter": {"literal": {"chatId": nil}},
                "emailFilter": {"tree": {"literal": {"threadId": nil}}},
                "calendarEventFilter": {"literal": {"id": nil}},
                "channelFilter": {"literal": {"channelId": nil}},
                "channelThreadFilter": {"literal": {"channelId": nil}},
                "callFilter": {"literal": {"callId": nil}},
                "crmCompanyFilter": {"literal": {"id": nil}},
                "foreignEntityFilter": {"literal": {"id": nil}},
            },
            "sortMethod": "UPDATED_AT", "sortDirection": "DESC", "limit": self.limit,
            "baseline": self.baseline.iter().map(|n| json!({
                "key": format!("GraphqlSoupProject:{}", id(*n)), "sortTimestamp": TIMES[0],
            })).collect::<Vec<_>>(),
            "liveQuery": {"id": self.id, "document": FRAGMENT, "fragmentName": "Item",
                "since": self.revision},
        }))
        .unwrap()
    }

    /// Reads as `createPredicateQuery` does and applies the delta.
    fn read(&mut self, handle: &EngineHandle) {
        let update =
            serde_json::to_value(block_on(handle.entity_filter(self.request())).unwrap()).unwrap();
        assert_eq!(update["kind"], "live-query", "{update}");
        if update["reset"] == true {
            self.rows.clear();
        }
        for key in update["removed"].as_array().unwrap() {
            self.rows.remove(key.as_str().unwrap());
        }
        for row in update["upserts"].as_array().unwrap() {
            self.rows.insert(
                row["recordKey"].as_str().unwrap().to_owned(),
                row["record"].clone(),
            );
        }
        for patch in update["patches"].as_array().unwrap() {
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
        self.observation = update["observationId"].as_str().map(str::to_owned);
    }

    fn shown(&self) -> Vec<(&String, &Value)> {
        self.keys
            .iter()
            .map(|key| (key, self.rows.get(key).expect("ordered key has a row")))
            .collect()
    }
}

fn views(rng: &mut Rng) -> Vec<View> {
    (0..6)
        .map(|n| {
            let mut members: Vec<u16> = (1..=PROJECTS).filter(|_| rng.below(3) == 0).collect();
            if members.is_empty() {
                members.push(1);
            }
            View {
                id: format!("fuzz-{n}"),
                limit: 2 + rng.below(members.len() as u64 + 2) as usize,
                baseline: members
                    .iter()
                    .copied()
                    .filter(|_| rng.below(2) == 0)
                    .collect(),
                members,
                revision: None,
                observation: None,
                keys: Vec::new(),
                rows: BTreeMap::new(),
            }
        })
        .collect()
}

fn run(seed: u64) -> (usize, usize) {
    let mut rng = Rng(seed);
    let old = spawn_handle();
    let new = spawn_handle();
    let mut projects: Vec<Project> = (0..=PROJECTS + 4)
        .map(|_| Project {
            favorite: false,
            updated: 0,
            parent: None,
        })
        .collect();
    // Half the projects exist at first; the rest enter views as writes create them.
    let everything: Vec<Value> = (1..=PROJECTS + 4)
        .filter(|_| rng.below(2) == 0)
        .map(|n| item(n, &projects[n as usize]))
        .collect();
    write(&old, everything.clone());
    write(&new, everything);
    let mut old_views = views(&mut Rng(seed ^ 0x9e37_79b9));
    let mut new_views = views(&mut Rng(seed ^ 0x9e37_79b9));
    for view in old_views.iter_mut() {
        view.read(&old);
    }
    for view in new_views.iter_mut() {
        view.read(&new);
    }
    let (mut skipped, mut changing) = (0, 0);
    for step in 0..STEPS {
        // One to three projects change; ids past PROJECTS are in no view.
        let mut items = Vec::new();
        for _ in 0..1 + rng.below(3) {
            let n = 1 + rng.below(u64::from(PROJECTS) + 4) as u16;
            let project = &mut projects[n as usize];
            match rng.below(4) {
                0 => project.favorite = !project.favorite,
                1 => project.updated = rng.below(TIMES.len() as u64) as usize,
                2 => project.parent = (rng.below(2) == 0).then(|| 1 + rng.below(4) as u16),
                _ => {}
            }
            items.push(item(n, project));
        }
        let old_write = write(&old, items.clone());
        let new_write = write(&new, items);
        assert_eq!(old_write.revision_advanced, new_write.revision_advanced);
        if !new_write.revision_advanced {
            assert_eq!(new_write.unchanged_views, None);
            continue;
        }
        changing += 1;
        for view in old_views.iter_mut() {
            view.read(&old);
        }
        let proven = new_write.unchanged_views.unwrap_or_default();
        for view in new_views.iter_mut() {
            if view
                .observation
                .as_ref()
                .is_some_and(|observation| proven.contains(observation))
            {
                skipped += 1;
                continue;
            }
            view.read(&new);
        }
        for (old_view, new_view) in old_views.iter().zip(&new_views) {
            assert_eq!(
                old_view.shown(),
                new_view.shown(),
                "seed {seed} step {step}: {} differs",
                old_view.id
            );
        }
    }
    (skipped, changing)
}

#[test]
fn skipping_views_a_write_proved_unchanged_shows_what_reading_them_does() {
    let (mut skipped, mut changing) = (0, 0);
    for seed in 1..=4u64 {
        let (s, c) = run(seed.wrapping_mul(0x5851_F42D_4C95_7F2D));
        skipped += s;
        changing += c;
    }
    // The proof must actually save reads, or the test proves nothing.
    assert!(changing > 500, "{changing} changing writes");
    assert!(
        skipped > changing,
        "{skipped} skipped reads over {changing} writes"
    );
    eprintln!("{changing} changing writes, {skipped} view reads skipped");
}
