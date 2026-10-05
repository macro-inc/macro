//! Shrinking, model-based tests of the real engine and subscriber-visible deltas.
//! The oracle stores ordinary documents plus ordered pending edits; it does not
//! normalize records, apply cache recipes, or use cache reads to derive expectations.

use cache_core::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use cache_core::engine::watch_query::QueryUpdate;
use cache_core::engine::{BeginOptimisticWrite, Engine, EngineError, ReadResult};
use cache_core::link_patch::{LinkOperation, LinkPathSegment, OptimisticLinkPatch, RecordRoot};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::revision::CacheRevision;
use cache_core::store::Storage;
use cache_core::value::EntityKey;
use proptest::prelude::*;
use serde_json::{Map, Value as Json, json};

const DOCUMENTS: u8 = 4;
const QUERY: &str = r#"
query Page($input: SoupInput!, $show: Boolean! = true) {
  user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument {
    name properties @include(if: $show) { id propertyDefinitionId value {
      __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
    } }
  } } nextCursor } }
}"#;
const ALIASED: &str = r#"
query Page($input: SoupInput!, $show: Boolean! = true) {
  viewer: user { key: id page: soup(input: $input) { rows: items {
    kind: __typename key: id ...Fields
  } cursor: nextCursor } }
}
fragment Fields on GraphqlSoupDocument {
  title: name assignments: properties @include(if: $show) {
    key: id definition: propertyDefinitionId selected: value {
      kind: __typename ... on GraphqlSelectOptionPropertyValue { ids: optionIds }
    }
  }
}"#;
const FRAGMENT: &str = r#"
fragment Parent on GraphqlSoupEntity {
  __typename id properties { id propertyDefinitionId }
}"#;
const SET: &str = r#"
mutation Set($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id propertyDefinitionId value {
    __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
  } }
}"#;
const OPTIONS: &str = r#"
mutation Options($input: UpdateEntityPropertyOptionsInput!) {
  updateEntityPropertyOptions(input: $input) { id propertyDefinitionId value {
    __typename ... on GraphqlSelectOptionPropertyValue { optionIds }
  } }
}"#;

#[derive(Clone, Debug)]
pub enum Action {
    Edit {
        document: u8,
        definition: u8,
        options: Vec<u8>,
        coalesce: bool,
        bulk: bool,
    },
    Commit {
        canonical: Option<Vec<u8>>,
    },
    Reject,
    Claim,
    Retry,
    StaleReply,
    Remote {
        document: u8,
        definition: u8,
        options: Vec<u8>,
    },
    Rename {
        document: u8,
        name: String,
    },
    Reorder,
    Restart,
    PollSlow,
    ToggleSelection,
    Teardown,
}

fn options() -> impl Strategy<Value = Vec<u8>> {
    proptest::collection::btree_set(0u8..5, 0..4).prop_map(|ids| ids.into_iter().collect())
}

pub fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        6 => (0..DOCUMENTS, 0u8..2, options(), any::<bool>(), any::<bool>())
            .prop_map(|(document, definition, options, coalesce, bulk)| Action::Edit {
                document, definition, options, coalesce, bulk,
            }),
        3 => proptest::option::of(options()).prop_map(|canonical| Action::Commit { canonical }),
        2 => Just(Action::Reject),
        1 => Just(Action::Claim),
        1 => Just(Action::Retry),
        1 => Just(Action::StaleReply),
        2 => (0..DOCUMENTS, 0u8..2, options()).prop_map(|(document, definition, options)|
            Action::Remote { document, definition, options }),
        2 => (0..DOCUMENTS, ".{0,24}").prop_map(|(document, name)| Action::Rename { document, name }),
        1 => Just(Action::Reorder),
        1 => Just(Action::Restart),
        1 => Just(Action::PollSlow),
        1 => Just(Action::ToggleSelection),
        1 => Just(Action::Teardown),
    ]
}

#[derive(Clone, Debug)]
struct Assignment {
    id: String,
    definition: u8,
    options: Vec<u8>,
}

#[derive(Clone)]
struct Document {
    name: String,
    properties: Vec<Assignment>,
}

#[derive(Clone)]
struct Pending {
    transaction: u64,
    uuid: String,
    superseded: bool,
    document: u8,
    assignment: Assignment,
    bulk: bool,
}

impl Pending {
    fn query(&self) -> &'static str {
        if self.bulk { OPTIONS } else { SET }
    }

    fn variables(&self) -> Map<String, Json> {
        let definition = self.assignment.definition.to_string();
        let ids = option_ids(&self.assignment.options);
        let input = if self.bulk {
            json!({"entityType":"DOCUMENT", "entityId":self.document.to_string(),
                "properties":[{"propertyDefinitionId":definition, "addOptionIds":ids,
                    "removeOptionIds":[]}]})
        } else {
            json!({"entityType":"DOCUMENT", "entityId":self.document.to_string(),
                "propertyDefinitionId":definition, "value":{"multiSelectOption":ids}})
        };
        Map::from_iter([("input".into(), input)])
    }

    fn response(&self, assignment: &Assignment) -> Json {
        let record = assignment_json(assignment, false);
        if self.bulk {
            json!({"updateEntityPropertyOptions":[record]})
        } else {
            json!({"setEntityProperty":record})
        }
    }
}

fn option_ids(options: &[u8]) -> Vec<String> {
    options.iter().map(u8::to_string).collect()
}

fn assignment_json(assignment: &Assignment, aliased: bool) -> Json {
    let value = if assignment.options.is_empty() {
        Json::Null
    } else if aliased {
        json!({"kind":"GraphqlSelectOptionPropertyValue", "ids":option_ids(&assignment.options)})
    } else {
        json!({"__typename":"GraphqlSelectOptionPropertyValue", "optionIds":option_ids(&assignment.options)})
    };
    if aliased {
        json!({"key":assignment.id,"definition":assignment.definition.to_string(),"selected":value})
    } else {
        json!({"id":assignment.id,"propertyDefinitionId":assignment.definition.to_string(),"value":value})
    }
}

fn apply(documents: &mut [Document], document: u8, assignment: &Assignment) {
    let properties = &mut documents[usize::from(document)].properties;
    if let Some(current) = properties
        .iter_mut()
        .find(|current| current.definition == assignment.definition)
    {
        *current = assignment.clone();
    } else {
        properties.insert(0, assignment.clone());
    }
}

fn page_data(documents: &[Document], order: &[u8], aliased: bool, show: bool) -> Json {
    let rows: Vec<_> = order
        .iter()
        .map(|id| {
            let document = &documents[usize::from(*id)];
            let properties: Vec<_> = document
                .properties
                .iter()
                .map(|assignment| assignment_json(assignment, aliased))
                .collect();
            let mut row = if aliased {
                json!({"kind":"GraphqlSoupDocument","key":id.to_string(),"title":document.name})
            } else {
                json!({"__typename":"GraphqlSoupDocument","id":id.to_string(),"name":document.name})
            };
            if show {
                row[if aliased { "assignments" } else { "properties" }] = json!(properties);
            }
            row
        })
        .collect();
    if aliased {
        json!({"viewer":{"key":"viewer","page":{"rows":rows,"cursor":null}}})
    } else {
        json!({"user":{"id":"viewer","soup":{"items":rows,"nextCursor":null}}})
    }
}

fn page_variables(page: u8, show: bool) -> Map<String, Json> {
    let mut variables = json!({"input":{"initial":{"limit":4 + page}}})
        .as_object()
        .unwrap()
        .clone();
    // Exercise omitted defaults as well as explicit directive variables.
    if !show {
        variables.insert("show".into(), json!(false));
    }
    variables
}

fn link_patch(pending: &Pending) -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        record_root: Some(RecordRoot {
            fragment_name: "Parent".into(),
            entity_key: EntityKey(format!("GraphqlSoupDocument:{}", pending.document).into()),
        }),
        query: FRAGMENT.into(),
        operation_name: None,
        variables_json: "{}".into(),
        path: vec![LinkPathSegment::Field {
            field: "properties".into(),
        }],
        operation: LinkOperation::UpsertByField {
            entity_key: EntityKey(format!("GraphqlProperty:{}", pending.assignment.id).into()),
            where_field: "propertyDefinitionId".into(),
            equals: json!(pending.assignment.definition.to_string()),
        },
    }
}

struct Subscriber {
    op: u64,
    page: u8,
    aliased: bool,
    show: bool,
    revision: Option<CacheRevision>,
    data: Json,
}

fn apply_patch(data: &mut Json, patch: LiveFieldPatch) {
    let mut target = data;
    for part in patch.path {
        target = match part {
            ResponsePathSegment::Field(field) => target.get_mut(&field),
            ResponsePathSegment::Index(index) => target.get_mut(index),
        }
        .expect("every patch must address an existing subscriber path");
    }
    assert_ne!(
        *target, patch.value,
        "unchanged fields must not be published"
    );
    *target = patch.value;
}

impl Subscriber {
    async fn check<S: Storage>(&mut self, engine: &mut Engine<S>, expected: Json) {
        let query = if self.aliased { ALIASED } else { QUERY };
        let update = engine
            .watch_query(
                self.op,
                query,
                Some("Page"),
                &page_variables(self.page, self.show),
                &[],
                self.revision,
            )
            .await
            .unwrap();
        let revision = match update {
            QueryUpdate::Hit { data, revision } => {
                self.data = data;
                revision
            }
            QueryUpdate::Patch { patches, revision } => {
                for patch in patches {
                    apply_patch(&mut self.data, patch);
                }
                revision
            }
            QueryUpdate::Miss { .. } => panic!("a complete model cannot produce a cache miss"),
        };
        self.revision = Some(revision.parse().unwrap());
        assert_eq!(self.data, expected, "subscriber {} diverged", self.op);
    }
}

struct Scenario<S: Storage, R> {
    engine: Engine<S>,
    reopen: R,
    base: Vec<Document>,
    pending: Vec<Pending>,
    orders: [Vec<u8>; 2],
    subscribers: Vec<Subscriber>,
    claim: Option<MutationClaimToken>,
    now: i64,
}

impl<S: Storage, R: FnMut(&S) -> S> Scenario<S, R> {
    async fn new(storage: S, reopen: R, capacity: usize) -> Self {
        let mut scenario = Self {
            engine: Engine::with_capacity(storage, capacity),
            reopen,
            base: (0..DOCUMENTS)
                .map(|id| Document {
                    name: format!("Task {id}"),
                    properties: vec![],
                })
                .collect(),
            pending: vec![],
            orders: [(0..DOCUMENTS).collect(), (0..DOCUMENTS).rev().collect()],
            subscribers: (0..3)
                .map(|id| Subscriber {
                    op: id + 1,
                    page: u8::from(id == 2),
                    aliased: id != 0,
                    show: true,
                    revision: None,
                    data: Json::Null,
                })
                .collect(),
            claim: None,
            now: 0,
        };
        scenario.write_base().await;
        scenario.check(true).await;
        scenario
    }

    fn effective(&self) -> Vec<Document> {
        let mut documents = self.base.clone();
        for pending in &self.pending {
            apply(&mut documents, pending.document, &pending.assignment);
        }
        documents
    }

    async fn write_base(&mut self) {
        for page in 0..2 {
            self.engine
                .write_query(
                    None,
                    QUERY,
                    Some("Page"),
                    &page_variables(page, true),
                    &page_data(&self.base, &self.orders[usize::from(page)], false, true),
                    None,
                )
                .await
                .unwrap();
        }
    }

    async fn check(&mut self, slow: bool) {
        let documents = self.effective();
        for (index, subscriber) in self.subscribers.iter_mut().enumerate() {
            if index == 2 && !slow {
                continue;
            }
            subscriber
                .check(
                    &mut self.engine,
                    page_data(
                        &documents,
                        &self.orders[usize::from(subscriber.page)],
                        subscriber.aliased,
                        subscriber.show,
                    ),
                )
                .await;
        }
        let ReadResult::Hit { data } = self
            .engine
            .read_query(None, QUERY, Some("Page"), &page_variables(0, true))
            .await
            .unwrap()
        else {
            panic!("snapshot missing")
        };
        assert_eq!(
            data,
            page_data(&documents, &self.orders[0], false, true),
            "ordinary read diverged"
        );
        let queue = self.engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(
            queue.iter().map(|entry| entry.id).collect::<Vec<_>>(),
            self.pending
                .iter()
                .map(|entry| entry.transaction)
                .collect::<Vec<_>>(),
            "queue ordering diverged"
        );
    }

    async fn claim(&mut self) {
        if self.claim.is_some() || self.pending.is_empty() {
            return;
        }
        let claimed = self
            .engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "model-runner".into(),
                now_ms: self.now,
                lease_expires_at_ms: self.now + 10_000,
            })
            .await
            .unwrap()
            .expect("non-deferred head must be runnable");
        assert_eq!(claimed.queued.id, self.pending[0].transaction);
        self.claim = Some(MutationClaimToken {
            owner: "model-runner".into(),
            generation: claimed.lease_generation,
        });
    }

    async fn step(&mut self, action: Action, sequence: usize, capacity: usize) {
        self.now += 1;
        match action {
            Action::Edit {
                document,
                definition,
                options,
                coalesce,
                bulk,
            } => {
                let effective = self.effective();
                let existing = effective[usize::from(document)]
                    .properties
                    .iter()
                    .find(|assignment| assignment.definition == definition);
                let temporary =
                    existing.is_none_or(|assignment| assignment.id.starts_with("temporary:"));
                let assignment = Assignment {
                    id: if temporary {
                        format!("temporary:{document}:{definition}")
                    } else {
                        existing.unwrap().id.clone()
                    },
                    definition,
                    options,
                };
                let uuid = uuid::Uuid::from_u128(if coalesce {
                    1 + u128::from(document) * 2 + u128::from(definition)
                } else {
                    1000 + sequence as u128
                })
                .to_string();
                let mut pending = Pending {
                    transaction: 0,
                    uuid,
                    superseded: false,
                    document,
                    assignment,
                    bulk,
                };
                let patches = vec![link_patch(&pending)];
                let (id, _) = self
                    .engine
                    .begin_optimistic_write(
                        None,
                        BeginOptimisticWrite {
                            uuid: &pending.uuid,
                            query: pending.query(),
                            operation_name: None,
                            variables: &pending.variables(),
                            data: &pending.response(&pending.assignment),
                            identity_bindings: &[],
                            link_patches: &patches,
                            revalidations: &[],
                            created_at_ms: self.now,
                        },
                    )
                    .await
                    .unwrap();
                if let Some(index) = self
                    .pending
                    .iter()
                    .rposition(|entry| entry.uuid == pending.uuid && !entry.superseded)
                {
                    if index == 0 && self.claim.is_some() {
                        self.pending[index].superseded = true;
                    } else {
                        self.pending.remove(index);
                    }
                }
                pending.transaction = id;
                self.pending.push(pending);
            }
            Action::Commit { canonical } => {
                self.claim().await;
                if let Some(claim) = self.claim.take() {
                    let pending = self.pending.remove(0);
                    let assignment = Assignment {
                        id: format!(
                            "server:{}:{}:{}",
                            pending.document, pending.assignment.definition, pending.transaction
                        ),
                        options: canonical.unwrap_or_else(|| pending.assignment.options.clone()),
                        ..pending.assignment.clone()
                    };
                    self.engine
                        .commit_optimistic_write(
                            pending.transaction,
                            claim,
                            pending.query(),
                            None,
                            &pending.variables(),
                            &pending.response(&assignment),
                        )
                        .await
                        .unwrap();
                    apply(&mut self.base, pending.document, &assignment);
                }
            }
            Action::Reject => {
                self.claim().await;
                if let Some(claim) = self.claim.take() {
                    let pending = self.pending.remove(0);
                    self.engine
                        .rollback_optimistic_write(pending.transaction, claim)
                        .await
                        .unwrap();
                }
            }
            Action::Claim => self.claim().await,
            Action::Retry => {
                self.claim().await;
                if let Some(claim) = self.claim.take() {
                    let pending = &self.pending[0];
                    self.engine
                        .defer_optimistic_write(
                            pending.transaction,
                            claim,
                            self.now + 2,
                            "retry".into(),
                        )
                        .await
                        .unwrap();
                    if pending.superseded {
                        self.pending.remove(0);
                    }
                    self.now += 3;
                }
            }
            Action::StaleReply => {
                self.claim().await;
                if let Some(claim) = &self.claim {
                    let pending = &self.pending[0];
                    let result = self
                        .engine
                        .commit_optimistic_write(
                            pending.transaction,
                            MutationClaimToken {
                                owner: claim.owner.clone(),
                                generation: claim.generation + 1,
                            },
                            pending.query(),
                            None,
                            &pending.variables(),
                            &pending.response(&pending.assignment),
                        )
                        .await;
                    assert!(
                        matches!(result, Err(EngineError::StaleMutationClaim(_))),
                        "stale response accepted: {result:?}"
                    );
                }
            }
            Action::Remote {
                document,
                definition,
                options,
            } => {
                apply(
                    &mut self.base,
                    document,
                    &Assignment {
                        id: format!("server:{document}:{definition}"),
                        definition,
                        options,
                    },
                );
                self.write_base().await;
            }
            Action::Rename { document, name } => {
                self.base[usize::from(document)].name = name;
                self.write_base().await;
            }
            Action::Reorder => {
                self.orders[0].rotate_left(1);
                self.orders[1].reverse();
                self.write_base().await;
            }
            Action::Restart => {
                self.engine = Engine::with_capacity((self.reopen)(self.engine.storage()), capacity);
                self.claim = None;
                self.now += 20_000;
            }
            Action::ToggleSelection => self.subscribers[1].show = !self.subscribers[1].show,
            Action::Teardown => self.engine.teardown_operation(self.subscribers[2].op),
            Action::PollSlow => {}
        }
    }
}

/// Run one generated history against a storage adapter and independent oracle.
pub async fn run<S: Storage, R: FnMut(&S) -> S>(
    storage: S,
    reopen: R,
    capacity: usize,
    actions: Vec<Action>,
) -> Engine<S> {
    let mut scenario = Scenario::new(storage, reopen, capacity).await;
    for (sequence, action) in actions.into_iter().enumerate() {
        let slow = matches!(action, Action::PollSlow | Action::Restart);
        scenario.step(action, sequence, capacity).await;
        scenario.check(slow).await;
    }
    // Settlement and reopening must not resurrect rejected edits or temporary IDs.
    while !scenario.pending.is_empty() {
        scenario
            .step(Action::Commit { canonical: None }, 0, capacity)
            .await;
        scenario.check(true).await;
    }
    scenario.step(Action::Restart, 0, capacity).await;
    scenario.check(true).await;
    scenario.engine
}
