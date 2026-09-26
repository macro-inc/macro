use crate::context::{ApiFuture, InitiativeApi};
use crate::*;
use async_graphql::{Context, EmptySubscription, ID, Object, Request, Schema, SimpleObject};
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;
use initiative::domain::{models::*, reads::*};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_permissions::share_permission::{
    LinkShareState, SharePermissionV2, access_level::AccessLevel,
};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

mod access;

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

impl SoupEntityEdges for TestSoupEdges {
    type Property = String;
    type Notification = String;
    type NotificationFilter = String;
    type ActivityEvent = String;
    type EmailThreadEdges = TestEmailThreadEdges;
    type AgentSessionEdges = TestAgentSessionEdges;

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
    ) -> async_graphql::Result<GraphqlInitiative<TestSoupEdges>> {
        resolve_initiative(ctx, self.0.clone(), initiative_id).await
    }
    async fn initiatives(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlInitiativePage<TestSoupEdges>> {
        resolve_initiatives(ctx, self.0.clone(), InitiativePageInput::default()).await
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
        description_document_id: DescriptionDocumentId::from_uuid(Uuid::from_u128(2)),
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
            description_document_id: detail.description_document_id,
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
}

impl RecordingApi {
    fn record(&self, user: &MacroUserIdStr<'static>, call: &str) -> Result<(), InitiativeError> {
        assert_eq!(user.to_string(), "macro|viewer@example.com");
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
    fn get(&self, user: MacroUserIdStr<'static>, _id: Uuid) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            self.record(&user, "get")?;
            Ok(detail())
        })
    }
    fn summary(
        &self,
        user: MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> ApiFuture<'_, InitiativePageRow> {
        Box::pin(async move {
            self.record(&user, "summary")?;
            Ok(row())
        })
    }
    fn page(
        &self,
        user: MacroUserIdStr<'static>,
        _input: InitiativePageRequest,
    ) -> ApiFuture<'_, InitiativePage> {
        Box::pin(async move {
            self.record(&user, "page")?;
            Ok(InitiativePage {
                initiatives: vec![row()],
                next_cursor: Some("cursor".into()),
            })
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
            self.updates.lock().unwrap().push(input);
            Ok(detail())
        })
    }
    fn create(
        &self,
        user: MacroUserIdStr<'static>,
        _input: CreateInitiativeRequest,
    ) -> ApiFuture<'_, InitiativeDetail> {
        Box::pin(async move {
            self.record(&user, "create")?;
            Ok(detail())
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
    Schema::build(Query, InitiativeMutationRoot::default(), EmptySubscription)
        .data(InitiativeGraphqlContext(api))
        .finish()
}

#[tokio::test]
async fn anonymous_queries_and_mutations_never_call_domain() {
    let api = Arc::new(RecordingApi::default());
    let schema = schema(api.clone());
    for query in [
        "{ user { id initiatives { nextCursor } } }",
        "mutation { createInitiative(input: { name: \"Launch\" }) { id } }",
    ] {
        let response = schema.execute(query).await;
        assert_eq!(response.errors[0].message, "authentication required");
    }
    assert!(api.calls.lock().unwrap().is_empty());
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
                    "{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ id }} }} }}"
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
async fn collection_and_detail_share_identity_and_lazy_details() {
    let api = Arc::new(RecordingApi::default());
    let schema = schema(api.clone());
    let response = schema.execute(Request::new("{ user { id initiatives { nextCursor initiatives { __typename id name ownerId memberIds createdAt taskCount completedTaskCount properties } } } }").data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["user"]["initiatives"]["initiatives"][0]["__typename"],
        "GraphqlInitiative"
    );
    assert_eq!(
        data["user"]["initiatives"]["initiatives"][0]["id"],
        PROJECT_ID
    );
    assert_eq!(*api.calls.lock().unwrap(), ["page", "get"]);
    api.calls.lock().unwrap().clear();
    let response = schema.execute(Request::new(format!("{{ user {{ initiative(initiativeId: \"{PROJECT_ID}\") {{ __typename id taskCount completedTaskCount propertySnapshot {{ completed }} }} }} }}")).data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(*api.calls.lock().unwrap(), ["get", "summary"]);
}

#[tokio::test]
async fn task_references_use_known_identity_without_fetching_each_project() {
    let api = Arc::new(RecordingApi::default());
    let response = schema(api.clone()).execute(Request::new("{ user { taskInitiativeReferences(taskIds: [\"visible\",\"hidden\",\"unassigned\"]) { taskId state initiative { __typename id name } } } }").data(user())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let references = &data["user"]["taskInitiativeReferences"];
    assert_eq!(
        references[0]["initiative"]["__typename"],
        "GraphqlInitiative"
    );
    assert_eq!(references[0]["initiative"]["id"], PROJECT_ID);
    assert!(references[1]["initiative"].is_null());
    assert!(references[2]["initiative"].is_null());
    assert_eq!(*api.calls.lock().unwrap(), ["references"]);
}
