use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use item_filters::ast::{
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
};
use model_owner::Owner;
use models_pagination::{Paginated, PaginatedCursor};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::{document::SoupDocument, email_thread::SoupEmailThreadPreview};
use soup::domain::{
    models::{
        EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, SoupErr, SoupPropertiesField,
        SoupRequest, grouping::ItemGroupingInfo,
    },
    ports::{SoupOutput, SoupService},
};

use super::*;

/// One Soup request observed by the recording service.
#[derive(Debug)]
struct RecordedRequest {
    /// User attached to the request.
    user_id: MacroUserIdStr<'static>,
    /// Requested page size.
    limit: u16,
    /// Inbox IDs attached to the request.
    link_ids: Vec<Uuid>,
    team_id: Option<String>,
}

/// Soup service that records raw requests and returns configured items by user.
#[derive(Clone, Default)]
struct RecordingSoupService {
    /// Requests received by the service.
    calls: Arc<Mutex<Vec<RecordedRequest>>>,
    /// Items returned for each user.
    responses: Arc<Mutex<HashMap<MacroUserIdStr<'static>, Vec<SoupItem<()>>>>>,
}

impl RecordingSoupService {
    /// Configure the items returned for a user.
    fn with_response(self, user_id: MacroUserIdStr<'static>, items: Vec<SoupItem<()>>) -> Self {
        self.responses
            .lock()
            .expect("responses lock")
            .insert(user_id, items);
        self
    }
}

impl SoupService for RecordingSoupService {
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        let items = self
            .responses
            .lock()
            .expect("responses lock")
            .get(&req.user)
            .cloned()
            .unwrap_or_default();
        self.calls
            .lock()
            .expect("calls lock")
            .push(RecordedRequest {
                user_id: req.user,
                limit: req.limit,
                link_ids: req.link_ids,
                team_id: team_receipt.map(|receipt| receipt.entity().entity_id.to_string()),
            });
        let page: PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> =
            Paginated::from_parts(items, None);
        Ok(SoupOutput::Simple(page))
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("loader only performs raw Soup queries")
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("loader only performs raw Soup queries")
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unreachable!("loader only performs raw Soup queries")
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        unreachable!("loader does not perform grouped Soup queries");
        #[allow(unreachable_code)]
        Ok(Vec::<ItemGroupingInfo<SoupPropertiesField>>::new().into_iter())
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        unreachable!("loader does not load tag definitions")
    }
}

/// Thread reader that records requests and returns configured previews by user.
#[derive(Clone, Default)]
struct RecordingThreadReader {
    /// Users and thread ids whose previews were requested.
    calls: Arc<Mutex<Vec<(MacroUserIdStr<'static>, Vec<Uuid>)>>>,
    /// Previews returned for each user.
    responses: Arc<HashMap<MacroUserIdStr<'static>, Vec<SoupEnrichedEmailThreadPreview<()>>>>,
}

impl SoupEmailThreadReader for RecordingThreadReader {
    async fn read_threads(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> Result<Vec<SoupEnrichedEmailThreadPreview<()>>, SoupItemLoaderError> {
        self.calls
            .lock()
            .expect("thread calls lock")
            .push((user_id.clone(), thread_ids));
        Ok(self.responses.get(&user_id).cloned().unwrap_or_default())
    }
}

/// Build a stable test user ID.
fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

/// Build a document Soup item for loader result mapping.
fn document(id: Uuid) -> SoupItem<()> {
    document_named(id, format!("Document {id}"))
}

/// Build a document Soup item with an explicit name.
fn document_named(id: Uuid, name: impl Into<String>) -> SoupItem<()> {
    SoupItem::Document(SoupDocument {
        id,
        document_version_id: 1,
        owner_id: Owner::from_principal_str("macro|owner@example.com").expect("valid owner"),
        name: name.into(),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: DateTime::<Utc>::default(),
        updated_at: DateTime::<Utc>::default(),
        viewed_at: None,
        sub_type: None,
        deleted_at: None,
        extra: (),
    })
}

/// Build an email thread preview as the access-checked reader returns it.
fn email_thread(id: Uuid) -> SoupEnrichedEmailThreadPreview<()> {
    SoupEnrichedEmailThreadPreview {
        thread: SoupEmailThreadPreview {
            id,
            provider_id: None,
            owner_id: user("macro|teammate@example.com"),
            inbox_visible: true,
            is_read: false,
            is_draft: false,
            is_important: false,
            is_signal: false,
            name: Some("Shared thread".to_owned()),
            snippet: None,
            sender_email: None,
            sender_name: None,
            sender_photo_url: None,
            sort_ts: DateTime::<Utc>::default(),
            created_at: DateTime::<Utc>::default(),
            updated_at: DateTime::<Utc>::default(),
            viewed_at: None,
            project_id: None,
        },
        attachments: Vec::new(),
        participants: Vec::new(),
        labels: Vec::new(),
        extra: (),
    }
}

/// Collect literal UUIDs from a binary expression tree.
fn collect_ids<T>(expr: &Expr<T>, literal_id: impl Copy + Fn(&T) -> Option<Uuid>) -> HashSet<Uuid> {
    match expr {
        Expr::And(left, right) | Expr::Or(left, right) => {
            let mut ids = collect_ids(left, literal_id);
            ids.extend(collect_ids(right, literal_id));
            ids
        }
        Expr::Not(inner) => collect_ids(inner, literal_id),
        Expr::Literal(literal) => literal_id(literal).into_iter().collect(),
    }
}

#[tokio::test]
async fn batches_all_keys_for_one_user_into_one_soup_request() {
    let user_id = user("macro|one@example.com");
    let first_id = Uuid::from_u128(1);
    let second_id = Uuid::from_u128(2);
    let service = RecordingSoupService::default().with_response(
        user_id.clone(),
        vec![document(first_id), document(second_id)],
    );
    let calls = Arc::clone(&service.calls);
    let loader = SoupItemLoader::new(service, RecordingThreadReader::default());
    let keys = vec![
        (
            user_id.clone(),
            EntityType::Document.with_entity_string(first_id.to_string()),
        ),
        (
            user_id.clone(),
            EntityType::Document.with_entity_string(second_id.to_string()),
        ),
    ];

    let loaded = Loader::<SoupItemLoaderKey>::load(&loader, &keys)
        .await
        .expect("batch loads");

    assert_eq!(loaded.len(), 2);
    let calls = calls.lock().expect("calls lock");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].user_id, user_id);
    assert_eq!(calls[0].limit, 2);
}

#[tokio::test]
async fn separates_one_soup_request_per_unique_user() {
    let first_user = user("macro|one@example.com");
    let second_user = user("macro|two@example.com");
    let first_id = Uuid::from_u128(1);
    let second_id = Uuid::from_u128(2);
    let service = RecordingSoupService::default()
        .with_response(first_user.clone(), vec![document(first_id)])
        .with_response(second_user.clone(), vec![document(second_id)]);
    let calls = Arc::clone(&service.calls);
    let loader = SoupItemLoader::new(service, RecordingThreadReader::default());
    let keys = vec![
        (
            first_user.clone(),
            EntityType::Document.with_entity_string(first_id.to_string()),
        ),
        (
            second_user.clone(),
            EntityType::Document.with_entity_string(second_id.to_string()),
        ),
    ];

    let loaded = Loader::<SoupItemLoaderKey>::load(&loader, &keys)
        .await
        .expect("batch loads");

    assert_eq!(loaded.len(), 2);
    let users = calls
        .lock()
        .expect("calls lock")
        .iter()
        .map(|call| call.user_id.clone())
        .collect::<HashSet<_>>();
    assert_eq!(users, HashSet::from([first_user, second_user]));
}

/// A thread outside the viewer's inboxes (a teammate's thread reached through
/// the team's CRM) hydrates when entity access grants it, without any inbox
/// scope and without a Soup request.
#[tokio::test]
async fn email_threads_hydrate_through_the_access_checked_reader_not_the_viewer_inboxes() {
    let user_id = user("macro|email@example.com");
    let first_id = Uuid::from_u128(11);
    let second_id = Uuid::from_u128(12);
    let service = RecordingSoupService::default();
    let soup_calls = Arc::clone(&service.calls);
    let thread_calls = Arc::new(Mutex::new(Vec::new()));
    let thread_reader = RecordingThreadReader {
        calls: Arc::clone(&thread_calls),
        responses: Arc::new(HashMap::from([(
            user_id.clone(),
            vec![email_thread(first_id), email_thread(second_id)],
        )])),
    };
    let loader = SoupItemLoader::new(service, thread_reader);
    let keys = vec![
        (
            user_id.clone(),
            EntityType::EmailThread.with_entity_string(first_id.to_string()),
        ),
        (
            user_id.clone(),
            EntityType::EmailThread.with_entity_string(second_id.to_string()),
        ),
    ];

    let loaded = Loader::<SoupItemLoaderKey>::load(&loader, &keys)
        .await
        .expect("batch loads");

    assert_eq!(loaded.len(), 2);
    assert!(matches!(
        &loaded[&keys[0]].item,
        SoupItem::EmailThread(thread) if thread.thread.id == first_id
    ));
    assert!(matches!(
        &loaded[&keys[1]].item,
        SoupItem::EmailThread(thread) if thread.thread.id == second_id
    ));
    assert_eq!(
        *thread_calls.lock().expect("thread calls lock"),
        vec![(user_id, vec![first_id, second_id])]
    );
    assert!(soup_calls.lock().expect("Soup calls lock").is_empty());
}

#[tokio::test]
async fn email_threads_and_other_entities_hydrate_side_by_side() {
    let user_id = user("macro|mixed@example.com");
    let document_id = Uuid::from_u128(14);
    let thread_id = Uuid::from_u128(15);
    let service =
        RecordingSoupService::default().with_response(user_id.clone(), vec![document(document_id)]);
    let soup_calls = Arc::clone(&service.calls);
    let thread_reader = RecordingThreadReader {
        calls: Arc::default(),
        responses: Arc::new(HashMap::from([(
            user_id.clone(),
            vec![email_thread(thread_id)],
        )])),
    };
    let loader = SoupItemLoader::new(service, thread_reader);
    let keys = vec![
        (
            user_id.clone(),
            EntityType::Document.with_entity_string(document_id.to_string()),
        ),
        (
            user_id.clone(),
            EntityType::EmailThread.with_entity_string(thread_id.to_string()),
        ),
    ];

    let loaded = Loader::<SoupItemLoaderKey>::load(&loader, &keys)
        .await
        .expect("batch loads");

    assert_eq!(loaded.len(), 2);
    let soup_calls = soup_calls.lock().expect("Soup calls lock");
    assert_eq!(soup_calls.len(), 1);
    assert_eq!(soup_calls[0].limit, 1);
    assert!(soup_calls[0].link_ids.is_empty());
}

#[tokio::test]
async fn a_thread_the_reader_withholds_is_absent() {
    let user_id = user("macro|denied@example.com");
    let entity = EntityType::EmailThread.with_entity_string(Uuid::from_u128(16).to_string());
    let loader = SoupItemDataLoader::new(SoupItemLoader::new(
        RecordingSoupService::default(),
        RecordingThreadReader::default(),
    ));

    let item = loader
        .load_one((user_id, entity))
        .await
        .expect("an inaccessible thread is not a loader failure");

    assert!(item.is_none());
}

#[tokio::test]
async fn context_loader_does_not_cache_across_realtime_updates() {
    let user_id = user("macro|fresh@example.com");
    let document_id = Uuid::from_u128(20);
    let entity = EntityType::Document.with_entity_string(document_id.to_string());
    let service = RecordingSoupService::default()
        .with_response(user_id.clone(), vec![document_named(document_id, "First")]);
    let calls = Arc::clone(&service.calls);
    let responses = Arc::clone(&service.responses);
    let loader = SoupItemDataLoader::new(SoupItemLoader::new(
        service,
        RecordingThreadReader::default(),
    ));

    let first = loader
        .load_one((user_id.clone(), entity.clone()))
        .await
        .expect("first load succeeds")
        .expect("first item exists");
    responses
        .lock()
        .expect("responses lock")
        .insert(user_id.clone(), vec![document_named(document_id, "Second")]);
    let second = loader
        .load_one((user_id, entity))
        .await
        .expect("second load succeeds")
        .expect("second item exists");

    assert!(matches!(first.item, SoupItem::Document(document) if document.name == "First"));
    assert!(matches!(second.item, SoupItem::Document(document) if document.name == "Second"));
    assert_eq!(calls.lock().expect("calls lock").len(), 2);
}

#[tokio::test]
async fn context_loader_returns_none_for_a_missing_item() {
    let user_id = user("macro|missing@example.com");
    let entity = EntityType::Document.with_entity_string(Uuid::from_u128(21).to_string());
    let loader = SoupItemDataLoader::new(SoupItemLoader::new(
        RecordingSoupService::default(),
        RecordingThreadReader::default(),
    ));

    let item = loader
        .load_one((user_id, entity))
        .await
        .expect("missing item is not a loader failure");

    assert!(item.is_none());
}

#[test]
fn email_threads_are_not_encoded_into_the_soup_request() {
    let thread_id = Uuid::from_u128(20);
    let entities = vec![EntityType::EmailThread.with_entity_string(thread_id.to_string())];

    let error = entity_filter_ast(&entities).expect_err("email threads bypass Soup");

    assert!(error.to_string().contains("thread reader"));
}

#[test]
fn encodes_requested_ids_and_disables_unrequested_entity_branches() {
    let first_document = Uuid::from_u128(21);
    let second_document = Uuid::from_u128(22);
    let channel = Uuid::from_u128(23);
    let entities = vec![
        EntityType::Document.with_entity_string(first_document.to_string()),
        EntityType::Document.with_entity_string(second_document.to_string()),
        EntityType::Channel.with_entity_string(channel.to_string()),
    ];

    let ast = entity_filter_ast(&entities).expect("valid AST");

    let document_ids = collect_ids(
        ast.document_filter.as_deref().expect("document filter"),
        |literal| match literal {
            DocumentLiteral::Id(id) => Some(*id),
            _ => None,
        },
    );
    let channel_ids = collect_ids(
        ast.channel_filter.as_deref().expect("channel filter"),
        |literal| match literal {
            ChannelLiteral::ChannelId(id) => Some(*id),
            _ => None,
        },
    );
    assert_eq!(
        document_ids,
        HashSet::from([first_document, second_document])
    );
    assert_eq!(channel_ids, HashSet::from([channel]));

    let nil = Uuid::nil();
    assert_eq!(
        collect_ids(
            ast.project_filter.as_deref().expect("project filter"),
            |literal| {
                match literal {
                    ProjectLiteral::ProjectIdSelf(id) => Some(*id),
                    _ => None,
                }
            }
        ),
        HashSet::from([nil])
    );
    assert_eq!(
        collect_ids(
            ast.chat_filter.as_deref().expect("chat filter"),
            |literal| {
                match literal {
                    ChatLiteral::ChatId(id) => Some(*id),
                    _ => None,
                }
            }
        ),
        HashSet::from([nil])
    );
    assert!(matches!(
        ast.email_filter.tree.as_deref(),
        Some(Expr::Literal(EmailLiteral::ThreadId(id))) if id.is_nil()
    ));
    assert_eq!(
        collect_ids(
            ast.channel_thread_filter
                .as_deref()
                .expect("channel-thread filter"),
            |literal| match literal {
                ChannelThreadLiteral::ThreadId(id) => Some(*id),
                _ => None,
            }
        ),
        HashSet::from([nil])
    );
    assert_eq!(
        collect_ids(
            ast.call_filter.as_deref().expect("call filter"),
            |literal| {
                match literal {
                    CallLiteral::CallId(id) => Some(*id),
                    _ => None,
                }
            }
        ),
        HashSet::from([nil])
    );
    assert_eq!(
        collect_ids(
            ast.crm_company_filter.as_deref().expect("CRM filter"),
            |literal| match literal {
                CrmCompanyLiteral::Id(id) => Some(*id),
                _ => None,
            }
        ),
        HashSet::from([nil])
    );
    assert_eq!(
        collect_ids(
            ast.foreign_entity_filter
                .as_deref()
                .expect("foreign-entity filter"),
            |literal| match literal {
                ForeignEntityLiteral::Id(id) => Some(*id),
                _ => None,
            }
        ),
        HashSet::from([nil])
    );
}

#[test]
fn initiative_hydration_targets_exact_ids_and_disables_unrequested_initiatives() {
    let id = Uuid::from_u128(42);
    let entities = vec![EntityType::Initiative.with_entity_string(id.to_string())];
    let ast = entity_filter_ast(&entities).unwrap();
    assert!(
        matches!(ast.initiative_filter.as_deref(), Some(Expr::Literal(InitiativeLiteral::Id(actual))) if *actual == id)
    );
    let ast =
        entity_filter_ast(&[EntityType::Document.with_entity_string(id.to_string())]).unwrap();
    assert!(
        matches!(ast.initiative_filter.as_deref(), Some(Expr::Literal(InitiativeLiteral::Id(actual))) if actual.is_nil())
    );
}

#[test]
fn database_row_hydration_targets_exact_ids_and_rules_rows_out_otherwise() {
    use item_filters::ast::database_row::DatabaseRowLiteral;
    let row = Uuid::from_u128(0x70000000_0000_0000_0000_000000000001);

    let ast =
        entity_filter_ast(&[EntityType::DatabaseRow.with_entity_string(row.to_string())]).unwrap();
    assert_eq!(
        ast.database_row_filter.as_deref(),
        Some(&Expr::val(DatabaseRowLiteral::Id(row)))
    );

    let ast =
        entity_filter_ast(&[EntityType::Document.with_entity_string(row.to_string())]).unwrap();
    assert_eq!(
        ast.database_row_filter.as_deref(),
        Some(&Expr::val(DatabaseRowLiteral::Id(Uuid::nil())))
    );
}

struct CurrentTeam(Mutex<Option<EntityAccessReceipt<MemberTeamRole>>>);
impl SoupTeamReader for CurrentTeam {
    fn team_receipt(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, SoupItemLoaderError>>
    {
        Box::pin(async { Ok(self.0.lock().unwrap().clone()) })
    }
}

#[tokio::test]
async fn pr_and_session_hydration_recheck_team_on_each_batch() {
    use entity_access::domain::models::{EntityPermission, TeamRole};
    let viewer = user("macro|viewer@example.com");
    let team_id = Uuid::now_v7();
    let team = Arc::new(CurrentTeam(Mutex::new(Some(
        EntityAccessReceipt::try_new_authenticated_user(
            viewer.clone(),
            entity_access::domain::models::Entity {
                entity_type: EntityType::Team,
                entity_id: team_id.to_string(),
            },
            EntityPermission::TeamRole {
                role: TeamRole::Member,
            },
        )
        .unwrap(),
    ))));
    let soup = RecordingSoupService::default();
    let mut loader = SoupItemLoader::new(soup.clone(), RecordingThreadReader::default());
    loader.team_reader = Some(team.clone());
    let keys = vec![
        (
            viewer.clone(),
            EntityType::ForeignEntity.with_entity_string(Uuid::now_v7().to_string()),
        ),
        (
            viewer.clone(),
            EntityType::AgentSession.with_entity_string(Uuid::now_v7().to_string()),
        ),
    ];
    loader.load(&keys).await.unwrap();
    assert_eq!(
        soup.calls.lock().unwrap()[0].team_id,
        Some(team_id.to_string())
    );
    *team.0.lock().unwrap() = None;
    loader.load(&keys).await.unwrap();
    assert_eq!(soup.calls.lock().unwrap()[1].team_id, None);
}

fn depth<T>(expr: &Expr<T>) -> usize {
    match expr {
        Expr::And(left, right) | Expr::Or(left, right) => 1 + depth(left).max(depth(right)),
        Expr::Not(inner) => 1 + depth(inner),
        Expr::Literal(_) => 1,
    }
}

#[test]
fn a_full_batch_of_ids_is_a_shallow_tree() {
    let ids = (0..500).map(Uuid::from_u128).collect::<Vec<_>>();
    let tree = literal_tree(
        ids.iter().copied().map(DocumentLiteral::Id).collect(),
        DocumentLiteral::Id(Uuid::nil()),
    );
    assert!(depth(&tree) <= 10, "depth {}", depth(&tree));
    let collected = collect_ids(&tree, |literal| match literal {
        DocumentLiteral::Id(id) => Some(*id),
        _ => None,
    });
    assert_eq!(collected, ids.into_iter().collect());
}

#[tokio::test]
async fn crm_record_hydration_carries_the_viewer_team() {
    use entity_access::domain::models::{EntityPermission, TeamRole};
    let viewer = user("macro|viewer@example.com");
    let team_id = Uuid::now_v7();
    let team = Arc::new(CurrentTeam(Mutex::new(Some(
        EntityAccessReceipt::try_new_authenticated_user(
            viewer.clone(),
            entity_access::domain::models::Entity {
                entity_type: EntityType::Team,
                entity_id: team_id.to_string(),
            },
            EntityPermission::TeamRole {
                role: TeamRole::Member,
            },
        )
        .unwrap(),
    ))));
    let soup = RecordingSoupService::default();
    let mut loader = SoupItemLoader::new(soup.clone(), RecordingThreadReader::default());
    loader.team_reader = Some(team);
    for entity_type in [EntityType::CrmCompany, EntityType::CrmContact] {
        let keys = vec![(
            viewer.clone(),
            entity_type.with_entity_string(Uuid::now_v7().to_string()),
        )];
        loader.load(&keys).await.unwrap();
        assert_eq!(
            soup.calls.lock().unwrap().last().unwrap().team_id,
            Some(team_id.to_string()),
            "{entity_type} hydration needs the viewer's team"
        );
    }
}
