use super::*;
use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use std::sync::Mutex;

struct Reader {
    visible: Vec<Uuid>,
    calls: Arc<Mutex<Vec<Vec<Uuid>>>>,
    dependent: Option<Uuid>,
}

impl TaskDependencyReader for Reader {
    fn load<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'static>,
        ids: &'a [Uuid],
    ) -> BoxFuture<'a, Result<HashMap<Uuid, TaskDependencyData>, rootcause::Report>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(ids.to_vec());
            Ok(ids
                .iter()
                .filter(|id| self.visible.contains(id))
                .map(|id| {
                    (
                        *id,
                        TaskDependencyData {
                            facts: TaskDependencyState {
                                task_id: *id,
                                dependent_ids: if *id == self.visible[0] {
                                    self.dependent.into_iter().collect()
                                } else {
                                    vec![]
                                },
                                ..TaskDependencyState::default()
                            },
                            blocker_receipts: vec![],
                            properties: vec![],
                        },
                    )
                })
                .collect())
        })
    }
}

struct Query;
#[Object]
impl Query {
    async fn states(
        &self,
        ctx: &Context<'_>,
        ids: Vec<ID>,
    ) -> async_graphql::Result<Vec<GraphqlTaskDependencyState>> {
        load_task_dependency_batch(ctx, ids).await
    }
}

#[tokio::test]
async fn batch_omits_unavailable_tasks_and_rejects_oversized_input_before_loading() {
    let visible = Uuid::from_u128(1);
    let hidden = Uuid::from_u128(2);
    let calls = Arc::new(Mutex::new(vec![]));
    let loader = task_dependency_loader(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        Reader {
            visible: vec![visible],
            calls: calls.clone(),
            dependent: None,
        },
    );
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(loader)
        .finish();
    let response = schema
        .execute(format!(
            r#"{{ states(ids:["{visible}","{hidden}"]) {{ id isBlocked }} }}"#
        ))
        .await;
    assert!(response.errors.is_empty());
    let data = response.data.into_json().unwrap();
    assert_eq!(data["states"].as_array().unwrap().len(), 1);
    assert_eq!(data["states"][0]["id"], visible.to_string());
    assert_eq!(calls.lock().unwrap().len(), 1);

    let before = calls.lock().unwrap().len();
    let ids = vec![format!("\"{visible}\""); 501].join(",");
    let oversized = schema
        .execute(format!("{{ states(ids:[{ids}]) {{ id }} }}"))
        .await;
    assert!(!oversized.errors.is_empty());
    assert_eq!(calls.lock().unwrap().len(), before);
}

#[tokio::test]
async fn post_write_effects_include_dependents_absent_from_the_old_snapshot() {
    let task = Uuid::from_u128(1);
    let dependent = Uuid::from_u128(2);
    let loader = task_dependency_loader(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        Reader {
            visible: vec![task, dependent],
            calls: Arc::new(Mutex::new(vec![])),
            dependent: Some(dependent),
        },
    );
    let effects = load_task_property_effects(&loader, task, vec![task])
        .await
        .unwrap();
    assert_eq!(effects.len(), 2);
    assert!(
        effects
            .iter()
            .any(|state| state.id.as_str() == dependent.to_string())
    );
}

struct PrivacyReader(TaskDependencyData);

impl TaskDependencyReader for PrivacyReader {
    fn load<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'static>,
        ids: &'a [Uuid],
    ) -> BoxFuture<'a, Result<HashMap<Uuid, TaskDependencyData>, rootcause::Report>> {
        Box::pin(async move {
            Ok(ids
                .iter()
                .filter(|id| **id == self.0.facts.task_id)
                .map(|id| (*id, self.0.clone()))
                .collect())
        })
    }
}

#[tokio::test]
async fn readable_task_exposes_only_authorized_open_ids_without_narrowing_aggregate() {
    let task = Uuid::from_u128(1);
    let public = Uuid::from_u128(2);
    let private = Uuid::from_u128(3);
    // Private status changes and deletion change only the full aggregate, not
    // visibility evidence. Opaque graph membership remains canonical.
    for (visible, open) in [
        (vec![], vec![private]),
        (vec![public], vec![public, private]),
        (vec![public], vec![private]),
        (vec![public], vec![public]),
        (vec![public], vec![]),
    ] {
        let reader = PrivacyReader(TaskDependencyData {
            facts: TaskDependencyState {
                task_id: task,
                blocker_ids: vec![public, private],
                open_blocker_ids: open.clone(),
                ..Default::default()
            },
            blocker_receipts: visible
                .iter()
                .map(|id| {
                    ViewReceipt::dangerously_assert_authenticated_user(
                        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
                        &id.to_string(),
                        model_entity::EntityType::Document,
                    )
                })
                .collect(),
            properties: vec![],
        });
        let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
            .data(task_dependency_loader(
                MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
                reader,
            ))
            .finish();
        let response = schema.execute(format!(r#"{{ states(ids:["{task}","{private}"]) {{ id isBlocked openBlockerIds visibleBlockerIds }} }}"#)).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let data = response.data.into_json().unwrap();
        let states = data["states"].as_array().unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0]["isBlocked"], !open.is_empty());
        assert_eq!(
            states[0]["visibleBlockerIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<Vec<_>>(),
            visible.iter().map(ToString::to_string).collect::<Vec<_>>()
        );
        let expected = open
            .into_iter()
            .filter(|id| visible.contains(id))
            .collect::<Vec<_>>();
        assert_eq!(
            states[0]["openBlockerIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect::<Vec<_>>(),
            expected.iter().map(ToString::to_string).collect::<Vec<_>>()
        );
    }
}
