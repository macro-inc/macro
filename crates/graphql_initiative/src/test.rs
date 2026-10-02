use crate::context::{ApiFuture, InitiativeApi};
use crate::*;
use async_graphql::{Context, EmptySubscription, ID, Object, Request, Schema, SimpleObject};
use graphql_common::require_authenticated_user;
use graphql_soup::{GraphqlSoupInitiative, SoupEntityEdges};
use initiative::domain::{models::*, reads::*};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_permissions::share_permission::{
    LinkShareState, SharePermissionV2, access_level::AccessLevel,
};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

mod access;
mod soup;

use self::soup::RecordingSoupService;

/// Minimal composed Soup edge object used by the isolated mutation schema.
#[derive(Clone, SimpleObject)]
struct TestSoupEdges {
    /// Keeps the GraphQL object non-empty.
    available: bool,
}

/// Minimal email-specific edge object used by the isolated mutation schema.
#[derive(Clone, SimpleObject)]
struct TestEmailThreadEdges {
    /// Keeps the GraphQL object non-empty.
    available: bool,
}

/// Minimal agent-session-specific edge object used by the isolated schema.
#[derive(Clone, SimpleObject)]
struct TestAgentSessionEdges {
    /// Keeps the GraphQL object non-empty.
    available: bool,
}

#[derive(Clone)]
struct TestInitiativeEdges {
    id: Uuid,
}

#[Object]
impl TestInitiativeEdges {
    async fn member_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        Ok(load_initiative_detail(ctx, self.id)
            .await?
            .member_ids
            .iter()
            .map(ToString::to_string)
            .collect())
    }
    async fn task_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<ID>> {
        Ok(load_initiative_detail(ctx, self.id)
            .await?
            .task_ids
            .iter()
            .cloned()
            .map(ID)
            .collect())
    }
    async fn share_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlInitiativeSharePermission> {
        Ok(load_initiative_detail(ctx, self.id)
            .await?
            .share_permission
            .clone()
            .into())
    }
    async fn task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(load_initiative_summary(ctx, self.id).await?.task_count)
    }
    async fn completed_task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(load_initiative_summary(ctx, self.id)
            .await?
            .completed_task_count)
    }
}

impl SoupEntityEdges for TestSoupEdges {
    type Property = String;
    type Notification = String;
    type NotificationFilter = String;
    type ActivityEvent = String;
    type EmailThreadEdges = TestEmailThreadEdges;
    type AgentSessionEdges = TestAgentSessionEdges;
    type InitiativeEdges = TestInitiativeEdges;

    fn initiative_edges(id: Uuid) -> Self::InitiativeEdges {
        TestInitiativeEdges { id }
    }

    fn from_entity(_entity: Entity<'static>) -> Self {
        Self { available: true }
    }

    fn email_thread_edges(_email_thread_id: uuid::Uuid) -> Self::EmailThreadEdges {
        TestEmailThreadEdges { available: true }
    }

    async fn resolve_email_cache_projection(
        &self,
        _ctx: &Context<'_>,
        _email_thread_id: uuid::Uuid,
    ) -> async_graphql::Result<Option<String>> {
        Ok(None)
    }

    fn agent_session_edges(_bot_id: uuid::Uuid) -> Self::AgentSessionEdges {
        TestAgentSessionEdges { available: true }
    }

    async fn resolve_properties(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Property>> {
        Ok(Vec::new())
    }

    async fn resolve_notifications(
        &self,
        _ctx: &Context<'_>,
        _filter: Option<Self::NotificationFilter>,
        _limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Self::Notification>> {
        Ok(Vec::new())
    }

    async fn resolve_is_favorited(&self, _ctx: &Context<'_>) -> async_graphql::Result<bool> {
        Ok(false)
    }

    async fn resolve_viewer_permission(
        &self,
        _ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_permission::GraphqlEntityPermission>> {
        Ok(None)
    }

    async fn resolve_activity(
        &self,
        _ctx: &Context<'_>,
        _limit: Option<i32>,
    ) -> async_graphql::Result<Vec<Self::ActivityEvent>> {
        Ok(Vec::new())
    }
}

struct Query;
struct Viewer(MacroUserIdStr<'static>);

#[Object]
impl Query {
    async fn user(&self, ctx: &Context<'_>) -> async_graphql::Result<Viewer> {
        Ok(Viewer(require_authenticated_user(ctx)?))
    }
}

#[Object]
impl Viewer {
    async fn id(&self) -> ID {
        ID(self.0.to_string())
    }
    async fn initiative(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
    ) -> async_graphql::Result<GraphqlSoupInitiative<TestSoupEdges>> {
        resolve_initiative(ctx, initiative_id).await
    }

    async fn task_initiative_references(
        &self,
        ctx: &Context<'_>,
        task_ids: Vec<ID>,
    ) -> async_graphql::Result<Vec<GraphqlTaskInitiativeReference<TestSoupEdges>>> {
        resolve_task_initiative_references(ctx, self.0.clone(), task_ids).await
    }
}

const PROJECT_ID: &str = "00000000-0000-4000-8000-000000000001";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("viewer@example.com").unwrap()
}

fn detail() -> InitiativeDetail {
    InitiativeDetail {
        id: InitiativeId::from_uuid(Uuid::parse_str(PROJECT_ID).unwrap()),
        name: "Launch".into(),
        owner_id: user(),
        member_ids: vec![],
        task_ids: vec![],
        share_permission: SharePermissionV2::from_link_share_state(LinkShareState::Off),
        user_access_level: AccessLevel::Edit,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

fn row() -> InitiativePageRow {
    let detail = detail();
    InitiativePageRow {
        initiative: InitiativeSummary {
            id: detail.id,
            name: detail.name,
            updated_at: detail.updated_at,
        },
        user_access_level: AccessLevel::Edit,
        properties: InitiativePropertySnapshot::default(),
        task_count: 3,
        completed_task_count: 2,
    }
}

#[derive(Default)]
struct RecordingApi {
    calls: Mutex<Vec<String>>,
    updates: Mutex<Vec<UpdateInitiativeRequest>>,
    denied: bool,
    fail: bool,
    name: Mutex<Option<String>>,
    members: Mutex<Vec<MacroUserIdStr<'static>>>,
    viewers: Mutex<Vec<String>>,
    denied_ids: Mutex<Vec<Uuid>>,
    task_count: Mutex<Option<u32>>,
}

impl RecordingApi {
    fn current_detail(&self) -> InitiativeDetail {
        let mut current = detail();
        if let Some(name) = &*self.name.lock().unwrap() {
            current.name = name.clone();
        }
        current.member_ids = self.members.lock().unwrap().clone();
        current
    }

    fn record(&self, user: &MacroUserIdStr<'static>, call: &str) -> Result<(), InitiativeError> {
        self.viewers.lock().unwrap().push(user.to_string());
        self.calls.lock().unwrap().push(call.to_string());
        if self.denied {
            return Err(InitiativeError::Unauthorized);
        }
        if self.fail {
            return Err(InitiativeError::Internal(rootcause::report!(
                "private persistence details"
            )));
        }
        Ok(())
    }
}

impl InitiativeApi for RecordingApi {
    fn get(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            self.record(&user, "get")?;
            if self.denied_ids.lock().unwrap().contains(&id) {
                return Err(InitiativeError::Unauthorized);
            }
            let mut detail = self.current_detail();
            detail.id = InitiativeId::from_uuid(id);
            Ok(detail)
        })
    }
    fn ensure_description_surface(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> ApiFuture<'_, ()> {
        Box::pin(async move {
            self.record(&user, "ensure_description_surface")?;
            Ok(())
        })
    }
    fn summary(&self, user: MacroUserIdStr<'static>, id: Uuid) -> ApiFuture<'_, InitiativePageRow> {
        Box::pin(async move {
            self.record(&user, "summary")?;
            if self.denied_ids.lock().unwrap().contains(&id) {
                return Err(InitiativeError::Unauthorized);
            }
            let mut summary = row();
            if let Some(count) = *self.task_count.lock().unwrap() {
                summary.task_count = count;
            }
            Ok(summary)
        })
    }
    fn update(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
        input: UpdateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            self.record(&user, "update")?;
            if let Some(name) = &input.name {
                *self.name.lock().unwrap() = Some(name.clone());
            }
            if let Some(members) = &input.member_ids {
                *self.members.lock().unwrap() = members
                    .iter()
                    .map(|id| MacroUserIdStr::try_from(id.clone()).unwrap())
                    .collect();
            }
            self.updates.lock().unwrap().push(input);
            Ok(self.current_detail())
        })
    }
    fn create(
        &self,
        user: MacroUserIdStr<'static>,
        input: CreateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            self.record(&user, "create")?;
            *self.name.lock().unwrap() = Some(input.name);
            Ok(self.current_detail())
        })
    }
    fn tasks(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
        _input: InitiativeTasksRequest,
    ) -> ApiFuture<'_, InitiativeTasksPage> {
        Box::pin(async move {
            self.record(&user, "tasks")?;
            Ok(InitiativeTasksPage {
                task_ids: vec![],
                next_cursor: None,
                total: 0,
            })
        })
    }
    fn references(
        &self,
        user: MacroUserIdStr<'static>,
        _ids: Vec<String>,
    ) -> ApiFuture<'_, TaskInitiativeReferences> {
        Box::pin(async move {
            self.record(&user, "references")?;
            Ok(TaskInitiativeReferences {
                references: vec![
                    TaskInitiativeReference::Visible {
                        task_id: "visible".into(),
                        initiative: InitiativeReference {
                            id: detail().id,
                            name: "Launch".into(),
                        },
                    },
                    TaskInitiativeReference::Unavailable {
                        task_id: "hidden".into(),
                    },
                    TaskInitiativeReference::None {
                        task_id: "unassigned".into(),
                    },
                ],
            })
        })
    }
    fn delete(&self, user: MacroUserIdStr<'static>, _id: Uuid) -> ApiFuture<'_, ()> {
        Box::pin(async move { self.record(&user, "delete") })
    }
    fn assign(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
        _ids: Vec<String>,
    ) -> ApiFuture<'_, AssignTasksResponse> {
        Box::pin(async move {
            self.record(&user, "assign")?;
            Ok(AssignTasksResponse { results: vec![] })
        })
    }
    fn unassign(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
        _task: String,
    ) -> ApiFuture<'_, ()> {
        Box::pin(async move { self.record(&user, "unassign") })
    }
    fn clear(&self, user: MacroUserIdStr<'static>, _task: String) -> ApiFuture<'_, ()> {
        Box::pin(async move { self.record(&user, "clear") })
    }
}

fn schema(
    api: Arc<RecordingApi>,
) -> Schema<Query, InitiativeMutationRoot<TestSoupEdges>, EmptySubscription> {
    let replica = RecordingSoupService::replica();
    schema_with_soup(api, replica)
}

fn schema_with_soup(
    api: Arc<RecordingApi>,
    replica: RecordingSoupService,
) -> Schema<Query, InitiativeMutationRoot<TestSoupEdges>, EmptySubscription> {
    let primary = RecordingSoupService::primary(api.clone());
    schema_with_readers(api, replica, primary)
}

fn schema_with_readers(
    api: Arc<RecordingApi>,
    replica: RecordingSoupService,
    primary: RecordingSoupService,
) -> Schema<Query, InitiativeMutationRoot<TestSoupEdges>, EmptySubscription> {
    let context = InitiativeGraphqlContext(api);
    Schema::build(Query, InitiativeMutationRoot::default(), EmptySubscription)
        .data(context.clone())
        .data(replica.loader())
        .data(InitiativeEntityLoader(primary.loader()))
        .data(initiative_detail_loader(context.clone(), user()))
        .data(initiative_summary_loader(context, user()))
        .finish()
}

#[tokio::test]
async fn anonymous_queries_and_mutations_never_call_domain() {
    let api = Arc::new(RecordingApi::default());
    let schema = schema(api.clone());
    for query in [
        "{ user { id initiative(initiativeId: \"00000000-0000-4000-8000-000000000001\") { id } } }",
        "mutation { createInitiative(input: { name: \"Launch\" }) { id } }",
        "mutation { ensureInitiativeDescriptionSurface(initiativeId: \"00000000-0000-4000-8000-000000000001\") }",
    ] {
        let response = schema.execute(query).await;
        assert_eq!(response.errors[0].message, "authentication required");
    }
    assert!(api.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ensure_description_surface_returns_the_project_id_as_the_surface_id() {
    let api = Arc::new(RecordingApi::default());
    let response = schema(api.clone())
        .execute(
            Request::new(format!(
                "mutation {{ ensureInitiativeDescriptionSurface(initiativeId: \"{PROJECT_ID}\") }}"
            ))
            .data(user()),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["ensureInitiativeDescriptionSurface"],
        PROJECT_ID
    );
    assert_eq!(
        *api.calls.lock().unwrap(),
        vec!["ensure_description_surface".to_string()]
    );
}

#[tokio::test]
async fn invalid_project_identifier_never_calls_domain() {
    let api = Arc::new(RecordingApi::default());
    let response = schema(api.clone())
        .execute(
            Request::new("{ user { initiative(initiativeId: \"invalid\") { id } } }").data(user()),
        )
        .await;
    assert!(!response.errors.is_empty());
    assert!(api.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn domain_access_errors_and_internal_errors_preserve_safe_codes() {
    for (api, expected_message, expected_code) in [
        (
            RecordingApi {
                denied: true,
                ..Default::default()
            },
            "unauthorized",
            "FORBIDDEN",
        ),
        (
            RecordingApi {
                fail: true,
                ..Default::default()
            },
            "internal server error",
            "INTERNAL_SERVER_ERROR",
        ),
    ] {
        let response = schema(Arc::new(api))
            .execute(
                Request::new(format!(
                    "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ memberIds }} }} }}"
                ))
                .data(user()),
            )
            .await;
        assert_eq!(response.errors[0].message, expected_message);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&async_graphql::Value::from(expected_code))
        );
    }
}

#[tokio::test]
async fn share_patch_distinguishes_omission_null_and_value() {
    let api = Arc::new(RecordingApi::default());
    let schema = schema(api.clone());
    for input in [
        "{}",
        "{ linkShare: null, teamShareAccessLevel: null }",
        "{ linkShare: TEAM, linkShareAccessLevel: COMMENT, teamShareAccessLevel: EDIT }",
    ] {
        let response = schema.execute(Request::new(format!("mutation {{ updateInitiative(initiativeId: \"{PROJECT_ID}\", input: {{ sharePermission: {input} }}) {{ id }} }}")).data(user())).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
    }
    let updates = api.updates.lock().unwrap();
    let omitted = updates[0].share_permission.as_ref().unwrap();
    assert_eq!(omitted.link_share, None);
    assert_eq!(omitted.team_share_access_level, None);
    let cleared = updates[1].share_permission.as_ref().unwrap();
    assert_eq!(cleared.link_share, Some(None));
    assert_eq!(cleared.team_share_access_level, Some(None));
    assert_eq!(cleared.link_share_access_level, None);
    let set = updates[2].share_permission.as_ref().unwrap();
    assert_eq!(
        set.link_share,
        Some(Some(models_permissions::share_permission::LinkShare::Team))
    );
    assert_eq!(
        set.link_share_access_level,
        Some(Some(AccessLevel::Comment))
    );
    assert_eq!(set.team_share_access_level, Some(Some(AccessLevel::Edit)));
}

#[tokio::test]
async fn detail_fields_load_only_when_selected_and_share_one_domain_read() {
    let api = Arc::new(RecordingApi::default());
    let schema = schema(api.clone());
    let response = schema.execute(Request::new(format!(
        "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ __typename id displayName metadata {{ ownerId updatedAt viewedAt }} }} }} }}"
    )).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let item = &data["user"]["initiative"];
    assert_eq!(item["__typename"], "GraphqlSoupInitiative");
    assert_eq!(item["id"], PROJECT_ID);
    assert_eq!(item["displayName"], "Launch");
    assert!(api.calls.lock().unwrap().is_empty());

    let response = schema.execute(Request::new(format!(
        "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ memberIds taskIds taskCount completedTaskCount sharePermission {{ owner }} }} }} }}"
    )).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["initiative"]["taskCount"], 3);
    assert_eq!(data["user"]["initiative"]["completedTaskCount"], 2);
    let mut calls = api.calls.lock().unwrap().clone();
    calls.sort();
    assert_eq!(calls, ["get", "summary"]);
}

#[tokio::test]
async fn task_references_use_the_canonical_soup_entity_and_hide_inaccessible_projects() {
    let api = Arc::new(RecordingApi::default());
    let replica = RecordingSoupService::replica();
    let primary = RecordingSoupService::primary(api.clone());
    let response = schema_with_readers(api.clone(), replica.clone(), primary.clone()).execute(Request::new(
        "{ user { taskInitiativeReferences(taskIds: [\"visible\",\"hidden\",\"unassigned\"]) { taskId state initiative { __typename id displayName metadata { ownerId } } } } }"
    ).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let references = &data["user"]["taskInitiativeReferences"];
    assert_eq!(references[0]["state"], "VISIBLE");
    assert_eq!(references[1]["state"], "UNAVAILABLE");
    assert_eq!(references[2]["state"], "NONE");
    assert_eq!(
        references[0]["initiative"]["__typename"],
        "GraphqlSoupInitiative"
    );
    assert_eq!(references[0]["initiative"]["id"], PROJECT_ID);
    assert_eq!(references[0]["initiative"]["displayName"], "Launch");
    assert!(references[1]["initiative"].is_null());
    assert!(references[2]["initiative"].is_null());
    assert_eq!(*api.calls.lock().unwrap(), ["references"]);
    assert!(replica.calls.lock().unwrap().is_empty());
    assert_eq!(primary.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn mutation_replies_use_primary_state_and_preserve_viewed_metadata() {
    let api = Arc::new(RecordingApi::default());
    let replica = RecordingSoupService::replica();
    let schema = schema_with_soup(api.clone(), replica.clone());
    let response = schema.execute(Request::new(format!(
        "mutation {{ first: updateInitiative(initiativeId: \"{PROJECT_ID}\", input: {{ name: \"First\", memberIds: [\"macro|first@example.com\"] }}) {{ __typename id displayName memberIds metadata {{ viewedAt }} }} second: updateInitiative(initiativeId: \"{PROJECT_ID}\", input: {{ name: \"Second\", memberIds: [\"macro|second@example.com\"] }}) {{ __typename id displayName memberIds metadata {{ viewedAt }} }} }}"
    )).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    for (alias, name, member) in [
        ("first", "First", "macro|first@example.com"),
        ("second", "Second", "macro|second@example.com"),
    ] {
        assert_eq!(data[alias]["__typename"], "GraphqlSoupInitiative");
        assert_eq!(data[alias]["id"], PROJECT_ID);
        assert_eq!(data[alias]["displayName"], name);
        assert_eq!(data[alias]["memberIds"][0], member);
        assert_eq!(data[alias]["metadata"]["viewedAt"], soup::VIEWED_AT);
    }
    assert!(replica.calls.lock().unwrap().is_empty());
    assert_eq!(
        *api.calls.lock().unwrap(),
        ["update", "get", "update", "get"]
    );
    let response = schema.execute(Request::new(format!(
        "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ displayName memberIds }} }} }}"
    )).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["initiative"]["displayName"], "Second");
    assert_eq!(
        data["user"]["initiative"]["memberIds"][0],
        "macro|second@example.com"
    );
    assert!(replica.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn newly_created_project_uses_primary_hydration_before_replica_catches_up() {
    let api = Arc::new(RecordingApi::default());
    let replica = RecordingSoupService::empty();
    let schema = schema_with_soup(api, replica.clone());
    let response = schema.execute(Request::new(
        "mutation { createInitiative(input: { name: \"New launch\" }) { __typename id displayName metadata { viewedAt } } }"
    ).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["createInitiative"]["__typename"],
        "GraphqlSoupInitiative"
    );
    assert_eq!(data["createInitiative"]["id"], PROJECT_ID);
    assert_eq!(data["createInitiative"]["displayName"], "New launch");
    assert_eq!(
        data["createInitiative"]["metadata"]["viewedAt"],
        soup::VIEWED_AT
    );
    // Opening the newly created route immediately performs another network read.
    let opened = schema.execute(Request::new(format!(
        "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ __typename id displayName metadata {{ viewedAt }} }} }} }}"
    )).data(user())).await;
    assert!(opened.errors.is_empty(), "{:?}", opened.errors);
    assert_eq!(
        opened.data.into_json().unwrap()["user"]["initiative"],
        data["createInitiative"]
    );
    assert!(replica.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_or_revoked_project_is_not_exposed_by_detail_or_reference() {
    let api = Arc::new(RecordingApi::default());
    let replica = RecordingSoupService::replica();
    let primary = RecordingSoupService::empty();
    let schema = schema_with_readers(api.clone(), replica.clone(), primary.clone());
    let response = schema
        .execute(
            Request::new(format!(
                "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ id }} }} }}"
            ))
            .data(user()),
        )
        .await;
    assert_eq!(response.errors[0].message, "initiative not found");
    assert!(api.calls.lock().unwrap().is_empty());
    primary.calls.lock().unwrap().clear();

    let response = schema.execute(Request::new(
        "{ user { taskInitiativeReferences(taskIds: [\"visible\"]) { state initiative { id displayName } } } }"
    ).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let reference = &data["user"]["taskInitiativeReferences"][0];
    assert!(reference["initiative"].is_null());
    assert_eq!(reference["state"], "UNAVAILABLE");
    assert_eq!(primary.calls.lock().unwrap().len(), 1);
    assert!(
        replica.calls.lock().unwrap().is_empty(),
        "revoked primary access must not fall back to stale replica data"
    );

    let response = schema
        .execute(
            Request::new("{ user { taskInitiativeReferences(taskIds: [\"visible\"]) { state } } }")
                .data(user()),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"]["taskInitiativeReferences"][0]["state"],
        "UNAVAILABLE"
    );
}

#[tokio::test]
async fn detail_loaders_isolate_viewers_failures_and_subsequent_reads() {
    let api = Arc::new(RecordingApi::default());
    let project = Uuid::parse_str(PROJECT_ID).unwrap();
    let hidden = Uuid::from_u128(99);
    api.denied_ids.lock().unwrap().push(hidden);
    let other = MacroUserIdStr::try_from_email("other@example.com").unwrap();
    let context = InitiativeGraphqlContext(api.clone());
    let viewer_loader = initiative_detail_loader(context.clone(), user());
    let other_loader = initiative_detail_loader(context.clone(), other);
    let summary_loader = initiative_summary_loader(context, user());
    let results = viewer_loader.load_many([project, hidden]).await.unwrap();
    assert!(results[&project].is_ok());
    assert!(results[&hidden].is_err());
    let summaries = summary_loader.load_many([project, hidden]).await.unwrap();
    assert_eq!(summaries[&project].as_ref().unwrap().task_count, 3);
    assert!(summaries[&hidden].is_err());
    other_loader
        .load_one(project)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        api.viewers
            .lock()
            .unwrap()
            .iter()
            .any(|viewer| viewer == "macro|other@example.com")
    );

    *api.name.lock().unwrap() = Some("Updated after first read".into());
    let refreshed = viewer_loader
        .load_one(project)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(refreshed.name, "Updated after first read");
    *api.task_count.lock().unwrap() = Some(4);
    let refreshed_summary = summary_loader
        .load_one(project)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(refreshed_summary.task_count, 4);
}
