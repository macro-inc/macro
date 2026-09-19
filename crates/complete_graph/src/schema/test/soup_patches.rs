use super::*;
use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema, futures_util::StreamExt};
use graphql_entity_mutation::GraphqlEntityMutationResult;
use tracing::{
    Event, Metadata, Subscriber,
    field::{Field, Visit},
    span::{Attributes, Id, Record},
};

const PATCH_SELECTION: &str = r#"
    __typename
    ... on SoupUpdated { item { __typename id displayName cacheProjection } }
    ... on GraphqlCacheDeletion { graphqlTypeName entityId }
"#;

type RealtimeSchema = SoupSchema<
    CountingSoupService,
    TestRealtimeSubscriptionService,
    NoopWebSocketNotificationSubscriptionService,
    NoOpEmailService,
    NoOpEntityAccessService,
    SchemaOnlyAuthorizationService,
    SchemaOnlyState,
    NoOpEntityPropertyWriter,
    UnavailableEntityMutationService,
    NoOpFavoriteMutationService,
    NoOpChannelActivityMutationService,
    NoOpNotificationMutationService,
    NoOpSoupNotificationEdgeReader,
    NoOpEntityPropertyReader,
    NoOpSoupEmailContentEdgeReader,
    NoOpEntityFavoriteEdgeReader,
    NoOpEntityPermissionEdgeReader,
    NoOpActivityReader,
>;

type TestEdges = SoupEdges<
    NoOpSoupNotificationEdgeReader,
    NoOpEntityPropertyReader,
    NoOpSoupEmailContentEdgeReader,
    NoOpEntityFavoriteEdgeReader,
    NoOpEntityPermissionEdgeReader,
    NoOpActivityReader,
>;

fn entity(id: u128) -> model_entity::Entity<'static> {
    ModelEntityType::Document.with_entity_string(Uuid::from_u128(id).to_string())
}

async fn subscription_responses(
    soup: CountingSoupService,
    patches: Vec<Patch<model_entity::Entity<'static>>>,
) -> Vec<async_graphql::Response> {
    let (sender, receiver) = tokio::sync::mpsc::channel(16);
    for patch in patches {
        sender.send(patch).await.unwrap();
    }
    drop(sender);
    let loader = graphql_soup::soup_item_loader(soup.clone(), Arc::new(NoOpEmailService));
    let schema: RealtimeSchema = build_schema_with_services(
        soup,
        TestRealtimeSubscriptionService {
            receiver: Arc::new(Mutex::new(Some(receiver))),
            subscribed_user: Arc::new(Mutex::new(None)),
        },
        NoopWebSocketNotificationSubscriptionService,
    );
    let request = async_graphql::Request::new(format!(
        "subscription {{ soupUpdates {{ {PATCH_SELECTION} }} }}"
    ))
    .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap())
    .data(loader);
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        schema.execute_stream(request).collect(),
    )
    .await
    .expect("closed source terminates the subscription")
}

#[tokio::test]
async fn batch_keeps_last_operation_per_entity_and_batches_hydration() {
    let soup = CountingSoupService::default();
    soup.set_raw_response(vec![
        soup_document(Uuid::from_u128(1)),
        soup_document(Uuid::from_u128(2)),
    ]);
    let calls = soup.raw_calls.clone();
    let responses = subscription_responses(
        soup,
        vec![
            Patch::Updated(entity(1)),
            Patch::Deleted(entity(2)),
            Patch::Updated(entity(1)),
            Patch::Updated(entity(2)),
            Patch::Updated(entity(3)),
            Patch::Deleted(entity(3)),
        ],
    )
    .await;
    assert_eq!(responses.len(), 1);
    assert!(responses[0].errors.is_empty(), "{:?}", responses[0].errors);
    let data = responses[0].data.clone().into_json().unwrap();
    let patches = data["soupUpdates"].as_array().unwrap();
    assert_eq!(patches.len(), 3);
    for (patch, id) in patches[..2].iter().zip([1, 2]) {
        assert_eq!(patch["__typename"], "SoupUpdated");
        assert_eq!(patch["item"]["id"], Uuid::from_u128(id).to_string());
        assert!(patch["item"]["cacheProjection"].is_string());
    }
    assert_eq!(patches[2]["__typename"], "GraphqlCacheDeletion");
    assert_eq!(patches[2]["entityId"], Uuid::from_u128(3).to_string());
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "surviving updates share a DataLoader request"
    );
}

#[tokio::test]
async fn later_batches_can_update_the_same_entity_again() {
    let soup = CountingSoupService::default();
    soup.set_raw_response(vec![soup_document(Uuid::from_u128(1))]);
    let calls = soup.raw_calls.clone();
    // The subscription's receive buffer holds ten entries. Deduplication must
    // not remember the first batch's key and swallow the following update.
    let responses = subscription_responses(soup, vec![Patch::Updated(entity(1)); 11]).await;
    assert_eq!(responses.len(), 2);
    for response in responses {
        assert!(response.errors.is_empty());
        let data = response.data.into_json().unwrap();
        assert_eq!(data["soupUpdates"].as_array().unwrap().len(), 1);
        assert_eq!(
            data["soupUpdates"][0]["item"]["id"],
            Uuid::from_u128(1).to_string()
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn dedup_uses_entity_type_and_id_and_preserves_last_occurrence_order() {
    let soup = CountingSoupService::default();
    let calls = soup.raw_calls.clone();
    let project = ModelEntityType::Project.with_entity_string(Uuid::from_u128(1).to_string());
    let responses = subscription_responses(
        soup,
        vec![
            Patch::Updated(entity(1)),
            Patch::Deleted(project),
            Patch::Deleted(entity(1)),
        ],
    )
    .await;
    assert_eq!(responses.len(), 1);
    assert!(responses[0].errors.is_empty());
    let data = responses[0].data.clone().into_json().unwrap();
    let patches = data["soupUpdates"].as_array().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0]["graphqlTypeName"], "GraphqlSoupProject");
    assert_eq!(patches[1]["graphqlTypeName"], "GraphqlSoupDocument");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "superseded updates never hydrate"
    );
}

#[derive(Default)]
struct CapturedEvent {
    fields: HashMap<String, String>,
}

impl Visit for CapturedEvent {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.fields
            .insert(field.name().to_owned(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.fields
            .insert(field.name().to_owned(), format!("{value:?}"));
    }
}

struct EventCapture(Arc<Mutex<Vec<CapturedEvent>>>);

impl Subscriber for EventCapture {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.is_event() && metadata.target() == "graphql_soup::objects"
    }

    fn event(&self, event: &Event<'_>) {
        let mut captured = CapturedEvent::default();
        event.record(&mut captured);
        self.0.lock().unwrap().push(captured);
    }

    // This probe observes structured events only, not span state or formatting.
    fn new_span(&self, _attrs: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _span: &Id, _values: &Record<'_>) {}
    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}
    fn enter(&self, _span: &Id) {}
    fn exit(&self, _span: &Id) {}
}

fn captured_events() -> Arc<Mutex<Vec<CapturedEvent>>> {
    // The schema and DataLoader may poll work outside the test's scoped
    // dispatcher. Keep one probe for this test binary and select each test's
    // unique entity IDs. No production subscriber setup or formatter is needed.
    static EVENTS: std::sync::OnceLock<Arc<Mutex<Vec<CapturedEvent>>>> = std::sync::OnceLock::new();
    EVENTS
        .get_or_init(|| {
            let events = Arc::new(Mutex::new(Vec::new()));
            tracing::subscriber::set_global_default(EventCapture(events.clone()))
                .expect("test capture subscriber");
            events
        })
        .clone()
}

#[tokio::test]
async fn two_missing_updates_log_identities_without_emitting_nulls_or_deletions() {
    let events = captured_events();
    let soup = CountingSoupService {
        return_empty_raw: true,
        ..Default::default()
    };
    let responses = subscription_responses(
        soup,
        vec![Patch::Updated(entity(4)), Patch::Updated(entity(5))],
    )
    .await;
    assert!(
        responses.is_empty(),
        "a batch of misses emits no data frame"
    );
    let events = events.lock().unwrap();
    for id in [4, 5] {
        let entity_id = Uuid::from_u128(id).to_string();
        let matching = events
            .iter()
            .filter(|event| event.fields.get("entity_id") == Some(&entity_id))
            .collect::<Vec<_>>();
        assert_eq!(matching.len(), 1, "one hydration miss per entity");
        let fields = &matching[0].fields;
        assert!(fields["message"].contains("omitting update"));
        assert_eq!(fields["user_id"], VALID_USER_ID);
        assert_eq!(fields["entity_type"], "document");
    }
}

#[tokio::test]
async fn missing_update_does_not_suppress_valid_sibling_or_explicit_delete() {
    let soup = CountingSoupService::default();
    soup.set_raw_response(vec![soup_document(Uuid::from_u128(1))]);
    let responses = subscription_responses(
        soup,
        vec![
            Patch::Updated(entity(1)),
            Patch::Updated(entity(2)),
            Patch::Deleted(entity(3)),
        ],
    )
    .await;
    assert_eq!(responses.len(), 1);
    assert!(responses[0].errors.is_empty());
    let data = responses[0].data.clone().into_json().unwrap();
    let patches = data["soupUpdates"].as_array().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0]["item"]["id"], Uuid::from_u128(1).to_string());
    assert_eq!(patches[1]["entityId"], Uuid::from_u128(3).to_string());
}

#[tokio::test]
async fn hydration_service_failure_is_an_error_not_a_deletion() {
    let events = captured_events();
    let responses = subscription_responses(
        CountingSoupService::default(),
        vec![Patch::Updated(entity(6))],
    )
    .await;
    assert_eq!(responses.len(), 1);
    assert!(!responses[0].errors.is_empty());
    assert!(
        !responses[0]
            .data
            .to_string()
            .contains("GraphqlCacheDeletion")
    );
    let events = events.lock().unwrap();
    let entity_id = Uuid::from_u128(6).to_string();
    let event = events
        .iter()
        .find(|event| event.fields.get("entity_id") == Some(&entity_id))
        .expect("hydration failure logs its entity");
    assert!(event.fields["message"].contains("failed to hydrate Soup update"));
    assert!(event.fields.contains_key("error"));
    assert_eq!(event.fields["user_id"], VALID_USER_ID);
}

struct MutationEffectsQuery;
#[Object]
impl MutationEffectsQuery {
    async fn result(&self) -> GraphqlEntityMutationResult<TestEdges> {
        GraphqlEntityMutationResult::from_updated_entity(entity(1))
    }
}

#[tokio::test]
async fn mutation_effects_share_non_nullable_hydration_and_omit_misses() {
    let soup = CountingSoupService::default();
    soup.set_raw_response(vec![soup_document(Uuid::from_u128(1))]);
    let loader = graphql_soup::soup_item_loader(soup.clone(), Arc::new(NoOpEmailService));
    let schema = Schema::build(MutationEffectsQuery, EmptyMutation, EmptySubscription)
        .data(loader)
        .data(entity_mutation::EntityMutationActor {
            user_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            organization_id: None,
        })
        .finish();
    let query = format!(
        "{{ result {{ ... on GraphqlMutationSuccess {{ effects {{ {PATCH_SELECTION} }} }} }} }}"
    );
    let response = schema.execute(&query).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["result"]["effects"][0]["item"]["id"],
        Uuid::from_u128(1).to_string()
    );
    soup.set_raw_response(Vec::new());
    let response = schema.execute(&query).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert!(data["result"]["effects"].as_array().unwrap().is_empty());
}
