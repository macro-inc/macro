use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Utc};
use either::Either;
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
use models_pagination::{Paginated, PaginatedCursor};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::document::SoupDocument;
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
        assert!(team_receipt.is_none());
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
            });
        let page: PaginatedCursor<SoupItem<()>, String, SimpleSortMethod, T> =
            Paginated::from_parts(items, None);
        Ok(Either::Left(page))
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

/// Inbox reader that records users and returns configured inbox IDs.
#[derive(Clone, Default)]
struct RecordingInboxReader {
    /// Users whose inboxes were requested.
    calls: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    /// Inbox IDs returned for each user.
    responses: Arc<HashMap<MacroUserIdStr<'static>, Vec<Uuid>>>,
}

impl SoupInboxReader for RecordingInboxReader {
    async fn get_inbox_ids(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Uuid>, SoupItemLoaderError> {
        self.calls
            .lock()
            .expect("inbox calls lock")
            .push(user_id.clone());
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
        owner_id: user("macro|owner@example.com"),
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
    let loader = SoupItemLoader::new(service, RecordingInboxReader::default());
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
    let loader = SoupItemLoader::new(service, RecordingInboxReader::default());
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

#[tokio::test]
async fn resolves_inboxes_once_for_a_users_email_entities() {
    let user_id = user("macro|email@example.com");
    let first_id = Uuid::from_u128(11);
    let second_id = Uuid::from_u128(12);
    let inbox_id = Uuid::from_u128(13);
    let service = RecordingSoupService::default();
    let soup_calls = Arc::clone(&service.calls);
    let inbox_calls = Arc::new(Mutex::new(Vec::new()));
    let inbox_reader = RecordingInboxReader {
        calls: Arc::clone(&inbox_calls),
        responses: Arc::new(HashMap::from([(user_id.clone(), vec![inbox_id])])),
    };
    let loader = SoupItemLoader::new(service, inbox_reader);
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

    Loader::<SoupItemLoaderKey>::load(&loader, &keys)
        .await
        .expect("batch loads");

    assert_eq!(inbox_calls.lock().expect("inbox calls lock").len(), 1);
    assert_eq!(
        soup_calls.lock().expect("Soup calls lock")[0].link_ids,
        vec![inbox_id]
    );
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
        RecordingInboxReader::default(),
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

    assert!(matches!(first, SoupItem::Document(document) if document.name == "First"));
    assert!(matches!(second, SoupItem::Document(document) if document.name == "Second"));
    assert_eq!(calls.lock().expect("calls lock").len(), 2);
}

#[tokio::test]
async fn context_loader_returns_none_for_a_missing_item() {
    let user_id = user("macro|missing@example.com");
    let entity = EntityType::Document.with_entity_string(Uuid::from_u128(21).to_string());
    let loader = SoupItemDataLoader::new(SoupItemLoader::new(
        RecordingSoupService::default(),
        RecordingInboxReader::default(),
    ));

    let item = loader
        .load_one((user_id, entity))
        .await
        .expect("missing item is not a loader failure");

    assert!(item.is_none());
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
    assert_eq!(
        collect_ids(
            ast.email_filter.tree.as_deref().expect("email filter"),
            |literal| match literal {
                EmailLiteral::ThreadId(id) => Some(*id),
                _ => None,
            }
        ),
        HashSet::from([nil])
    );
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
