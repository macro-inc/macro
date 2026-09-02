use crate::domain::models::{NotifiedEntity, TouchedEntity};
use crate::domain::ports::MockSoupRepo;
use channels::domain::{
    models::{
        ChannelMessage, GetChannelsRequest, GetThreadReplyRowsRequest, ThreadInfo, ThreadReply,
    },
    ports::ChannelListService,
};
use chrono::Days;
use chrono::{DateTime, Utc};
use cool_asserts::assert_matches;
use email::domain::models::{EnrichedEmailThreadPreview, PreviewView};
use entity_access::domain::models::{
    AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use filter_ast::Expr;
use foreign_entity::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use frecency::domain::models::{FrecencyPageRequest, FrecencyPageResponse};
use frecency::domain::ports::MockFrecencyQueryService;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::{domain::models::AggregateFrecency, outbound::mock::MockFrecencyStorage};
use item_filters::{
    ChannelThreadFilters, EntityFilters, ForeignEntityFilters,
    ast::{EntityFilterAst, foreign_entity::ForeignEntityLiteral},
};
use model_entity::EntityType;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{
    Cursor, CursorVal, CursorWithValAndFilter, FrecencyValue, PaginatedCursor, SimpleSortMethod,
    TypeEraseCursor,
};
use models_soup::document::{SoupDocument, SoupDocumentSubType};
use ordered_float::OrderedFloat;
use reminders::domain::models::{
    CreateReminder, Reminder, ReminderError, ReminderFilter, ReminderForSoup, ReminderPage,
    ReminderPatch,
};
use rootcause::Report;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::*;

struct NoopEmailPreviewService;

impl EmailPreviewServiceReadOnly for NoopEmailPreviewService {
    async fn get_email_thread_previews(
        &self,
        req: email::domain::models::GetEmailsRequest,
    ) -> Result<
        PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
        email::domain::models::EmailErr,
    > {
        assert!(!req.include_frecency);
        Ok(Option::<EnrichedEmailThreadPreview>::None
            .into_iter()
            .paginate_on(0, SimpleSortMethod::CreatedAt)
            .into_page())
    }
}

struct NoopCommsService;

impl ChannelListService for NoopCommsService {
    async fn get_channels(
        &self,
        req: GetChannelsRequest,
    ) -> Result<Vec<channels::domain::models::ChannelWithLatest>, Report> {
        assert!(!req.include_frecency);
        Ok(Vec::new())
    }

    async fn get_activities(
        &self,
        _user: MacroUserIdStr<'_>,
    ) -> Result<Vec<channels::domain::models::Activity>, Report> {
        Ok(Vec::new())
    }

    async fn get_thread_messages(
        &self,
        _req: GetThreadReplyRowsRequest,
    ) -> Result<Vec<ChannelMessage>, Report> {
        Ok(Vec::new())
    }

    async fn get_names(
        &self,
        _names: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<channels::domain::models::UserName>, Report> {
        Ok(Vec::new())
    }
}

#[derive(Clone)]
struct RecordingCommsService {
    rows: Vec<ChannelMessage>,
    channel_calls: Arc<Mutex<u32>>,
    channel_filters: Arc<Mutex<Vec<String>>>,
    thread_filters: Arc<Mutex<Vec<String>>>,
}

impl RecordingCommsService {
    fn new(rows: Vec<ChannelMessage>) -> Self {
        Self {
            rows,
            channel_calls: Arc::new(Mutex::new(0)),
            channel_filters: Arc::new(Mutex::new(Vec::new())),
            thread_filters: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn channel_calls(&self) -> u32 {
        *self.channel_calls.lock().unwrap()
    }

    fn channel_filters(&self) -> Vec<String> {
        self.channel_filters.lock().unwrap().clone()
    }

    fn thread_filters(&self) -> Vec<String> {
        self.thread_filters.lock().unwrap().clone()
    }
}

impl ChannelListService for RecordingCommsService {
    async fn get_channels(
        &self,
        req: GetChannelsRequest,
    ) -> Result<Vec<channels::domain::models::ChannelWithLatest>, Report> {
        assert!(!req.include_frecency);
        *self.channel_calls.lock().unwrap() += 1;
        self.channel_filters
            .lock()
            .unwrap()
            .push(serde_json::to_string(req.query.filter()).unwrap());
        Ok(Vec::new())
    }

    async fn get_activities(
        &self,
        _user: MacroUserIdStr<'_>,
    ) -> Result<Vec<channels::domain::models::Activity>, Report> {
        Ok(Vec::new())
    }

    async fn get_thread_messages(
        &self,
        req: GetThreadReplyRowsRequest,
    ) -> Result<Vec<ChannelMessage>, Report> {
        self.thread_filters
            .lock()
            .unwrap()
            .push(serde_json::to_string(req.query.filter()).unwrap());
        Ok(self.rows.clone())
    }

    async fn get_names(
        &self,
        _names: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<channels::domain::models::UserName>, Report> {
        Ok(Vec::new())
    }
}

struct NoopCallRecordQueryService;

impl CallRecordQueryService for NoopCallRecordQueryService {
    async fn get_user_call_records(
        &self,
        _req: call::domain::models::GetCallRecordsRequest,
    ) -> Result<Vec<call::domain::models::CallRecord>, call::domain::models::CallError> {
        Ok(Vec::new())
    }
}

#[derive(Clone)]
struct RecordingCallRecordQueryService {
    records: Vec<call::domain::models::CallRecord>,
    calls: Arc<Mutex<u32>>,
}

impl RecordingCallRecordQueryService {
    fn new(records: Vec<call::domain::models::CallRecord>) -> Self {
        Self {
            records,
            calls: Arc::new(Mutex::new(0)),
        }
    }

    fn calls(&self) -> u32 {
        *self.calls.lock().unwrap()
    }
}

impl CallRecordQueryService for RecordingCallRecordQueryService {
    async fn get_user_call_records(
        &self,
        _req: call::domain::models::GetCallRecordsRequest,
    ) -> Result<Vec<call::domain::models::CallRecord>, call::domain::models::CallError> {
        *self.calls.lock().unwrap() += 1;
        Ok(self.records.clone())
    }
}

fn call_record(
    call_id: Uuid,
    channel_id: Uuid,
    created_by: &str,
    started_at: DateTime<Utc>,
) -> call::domain::models::CallRecord {
    call::domain::models::CallRecord {
        call_id,
        channel_id,
        room_name: String::new(),
        created_by: created_by.to_string(),
        started_at,
        ended_at: None,
        duration_ms: None,
        egress_id: None,
        recording_started_at: None,
        recording_key: None,
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: None,
        summary: None,
        share_with_team: false,
        is_active: true,
        status: None,
        user_access_level: None,
        participants: Vec::new(),
        transcript: Vec::new(),
    }
}

fn foreign_entity_id_from_receipt(
    receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> Result<Uuid, ForeignEntityError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::ForeignEntity {
        return Err(ForeignEntityError::BadRequest(format!(
            "expected ForeignEntity receipt, got {:?}",
            entity.entity_type
        )));
    }

    Uuid::parse_str(&entity.entity_id).map_err(|_| {
        ForeignEntityError::BadRequest("foreign entity receipt id must be a valid UUID".to_string())
    })
}
use crm::domain::service::NoOpCrmService;
use reminders::domain::service::NoOpRemindersService;

#[derive(Clone)]
struct NoopForeignEntityService;

impl ForeignEntityService for NoopForeignEntityService {
    async fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let id = foreign_entity_id_from_receipt(receipt)?;
        self.get_foreign_entity_by_id(id).await
    }

    async fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        Err(ForeignEntityError::NotFound(id))
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        _foreign_entity_id: &str,
        _foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(Vec::new())
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        _source_ids: Vec<SourceId>,
        _limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(Vec::new())
    }

    async fn create_foreign_entity(
        &self,
        _create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("NoopForeignEntityService does not create foreign entities")
    }

    async fn delete_foreign_entity(&self, _id: Uuid) -> Result<(), ForeignEntityError> {
        unreachable!("NoopForeignEntityService does not delete foreign entities")
    }

    async fn patch_foreign_entity(
        &self,
        _id: Uuid,
        _patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("NoopForeignEntityService does not patch foreign entities")
    }
}

#[derive(Clone)]
struct RecordingForeignEntityService {
    state: Arc<RecordingForeignEntityState>,
}

struct RecordingForeignEntityState {
    calls: Mutex<Vec<RecordedForeignEntityCall>>,
    entities: Vec<ForeignEntity>,
}

#[derive(Clone)]
struct RecordedForeignEntityCall {
    requesting_user: Option<String>,
    source_ids: Vec<SourceId>,
    limit: u32,
    query: ForeignEntityListQuery,
}

fn foreign_entity_matches_filter(
    entity: &ForeignEntity,
    filter: &Option<Arc<Expr<ForeignEntityLiteral>>>,
) -> bool {
    filter
        .as_deref()
        .map(|expr| foreign_entity_matches_expr(entity, expr))
        .unwrap_or(true)
}

fn foreign_entity_matches_expr(entity: &ForeignEntity, expr: &Expr<ForeignEntityLiteral>) -> bool {
    match expr {
        Expr::And(left, right) => {
            foreign_entity_matches_expr(entity, left) && foreign_entity_matches_expr(entity, right)
        }
        Expr::Or(left, right) => {
            foreign_entity_matches_expr(entity, left) || foreign_entity_matches_expr(entity, right)
        }
        Expr::Not(inner) => !foreign_entity_matches_expr(entity, inner),
        Expr::Literal(literal) => foreign_entity_matches_literal(entity, literal),
    }
}

fn foreign_entity_matches_literal(entity: &ForeignEntity, literal: &ForeignEntityLiteral) -> bool {
    match literal {
        ForeignEntityLiteral::Id(id) => entity.id == *id,
        ForeignEntityLiteral::ForeignEntityId(id) => {
            entity.foreign_entity_id.as_str() == id.as_str()
        }
        ForeignEntityLiteral::ForeignEntitySource(source) => {
            entity.foreign_entity_source.as_str() == source.as_str()
        }
        // "me" and notification done/seen resolution happen in the repository (against the
        // metadata participant list and the notification tables); the fake cannot resolve them,
        // so fail closed.
        ForeignEntityLiteral::IncludesMe
        | ForeignEntityLiteral::NotificationDone(_)
        | ForeignEntityLiteral::NotificationSeen(_) => false,
    }
}

impl RecordingForeignEntityService {
    fn new(entities: Vec<ForeignEntity>) -> Self {
        Self {
            state: Arc::new(RecordingForeignEntityState {
                calls: Mutex::new(Vec::new()),
                entities,
            }),
        }
    }

    fn calls(&self) -> Vec<RecordedForeignEntityCall> {
        self.state.calls.lock().unwrap().clone()
    }
}

impl ForeignEntityService for RecordingForeignEntityService {
    async fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let id = foreign_entity_id_from_receipt(receipt)?;
        self.get_foreign_entity_by_id(id).await
    }

    async fn get_foreign_entity_by_id(
        &self,
        id: Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.state
            .entities
            .iter()
            .find(|entity| entity.id == id)
            .cloned()
            .ok_or(ForeignEntityError::NotFound(id))
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(self
            .state
            .entities
            .iter()
            .filter(|entity| entity.foreign_entity_id == foreign_entity_id)
            .filter(|entity| {
                foreign_entity_source
                    .map(|source| entity.foreign_entity_source == source)
                    .unwrap_or(true)
            })
            .cloned()
            .collect())
    }

    async fn get_foreign_entities_for_user(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        let filter = query.filter().clone();

        self.state
            .calls
            .lock()
            .unwrap()
            .push(RecordedForeignEntityCall {
                requesting_user,
                source_ids: source_ids.clone(),
                limit,
                query,
            });

        Ok(self
            .state
            .entities
            .iter()
            .filter(|entity| {
                source_ids.iter().any(|source_id| {
                    entity.stored_for_id.as_str() == source_id.id.as_str()
                        && entity.stored_for_auth_entity.as_str() == source_id.auth_entity.as_str()
                })
            })
            .filter(|entity| foreign_entity_matches_filter(entity, &filter))
            .take(limit as usize)
            .cloned()
            .collect())
    }

    async fn create_foreign_entity(
        &self,
        _create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("RecordingForeignEntityService does not create foreign entities")
    }

    async fn delete_foreign_entity(&self, _id: Uuid) -> Result<(), ForeignEntityError> {
        unreachable!("RecordingForeignEntityService does not delete foreign entities")
    }

    async fn patch_foreign_entity(
        &self,
        _id: Uuid,
        _patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("RecordingForeignEntityService does not patch foreign entities")
    }
}

fn soup_document(id: &str) -> SoupDocument {
    // Create a deterministic UUID from the string ID
    let uuid = Uuid::parse_str(id).unwrap_or_else(|_| {
        // For simple IDs like "doc-1", create a zero UUID with the number embedded
        let num: u128 = id
            .chars()
            .filter(|c| c.is_numeric())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
        Uuid::from_u128(num)
    });
    soup_document_uuid_with_updated(uuid, Default::default())
}

fn soup_document_with_updated(id: &str, updated_at: DateTime<Utc>) -> SoupDocument {
    // Create a deterministic UUID from the string ID
    let uuid = Uuid::parse_str(id).unwrap_or_else(|_| {
        // For simple IDs like "doc-1", create a zero UUID with the number embedded
        let num: u128 = id
            .chars()
            .filter(|c| c.is_numeric())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
        Uuid::from_u128(num)
    });
    soup_document_uuid_with_updated(uuid, updated_at)
}

fn soup_document_uuid_with_updated(id: Uuid, updated_at: DateTime<Utc>) -> SoupDocument {
    soup_document_with_is_completed(id, updated_at, None)
}

fn soup_document_with_is_completed(
    id: Uuid,
    updated_at: DateTime<Utc>,
    is_completed: Option<bool>,
) -> SoupDocument {
    SoupDocument {
        id,
        document_version_id: 1,
        owner_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        name: Default::default(),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: Default::default(),
        updated_at,
        viewed_at: Default::default(),
        sub_type: is_completed.map(|is_completed| SoupDocumentSubType::Task { is_completed }),
        deleted_at: None,
        extra: (),
    }
}

fn foreign_entity_for_source(
    id: Uuid,
    stored_for_id: impl Into<String>,
    stored_for_auth_entity: impl Into<String>,
    updated_at: DateTime<Utc>,
) -> ForeignEntity {
    ForeignEntity {
        id,
        foreign_entity_id: format!("external-{id}"),
        foreign_entity_source: "github".to_string(),
        metadata: serde_json::json!({}),
        stored_for_id: stored_for_id.into(),
        stored_for_auth_entity: stored_for_auth_entity.into(),
        created_at: DateTime::default(),
        updated_at,
    }
}

fn channel_thread_message(
    channel_id: Uuid,
    thread_id: Uuid,
    reply_id: Uuid,
    updated_at: DateTime<Utc>,
) -> ChannelMessage {
    ChannelMessage {
        id: thread_id,
        channel_id,
        sender_id: "macro|test@example.com".to_string(),
        bot_profile: None,
        content: "thread parent".to_string(),
        created_at: DateTime::default(),
        updated_at,
        edited_at: None,
        deleted_at: None,
        triggered_by: None,
        thread: ThreadInfo {
            reply_count: 1,
            latest_reply_at: Some(DateTime::default() + Days::new(1)),
            preview: vec![ThreadReply {
                id: reply_id,
                sender_id: "macro|other@example.com".to_string(),
                bot_profile: None,
                content: "thread reply".to_string(),
                created_at: DateTime::default() + Days::new(1),
                updated_at: DateTime::default() + Days::new(1),
                edited_at: None,
                triggered_by: None,
                reactions: Vec::new(),
                attachments: Vec::new(),
            }],
        },
        reactions: Vec::new(),
        attachments: Vec::new(),
    }
}

#[tokio::test]
async fn simple_soup_includes_channel_threads() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let channel_id = Uuid::from_u128(0xaaaa);
    let thread_id = Uuid::from_u128(0xbbbb);
    let reply_id = Uuid::from_u128(0xcccc);
    let comms_service = RecordingCommsService::new(vec![channel_thread_message(
        channel_id,
        thread_id,
        reply_id,
        DateTime::default() + Days::new(2),
    )]);

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        comms_service.clone(),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters::default(),
            ),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert_eq!(page.items.len(), 1);
    assert_matches!(
        &page.items[0],
        SoupItem::ChannelThread(thread) => {
            assert_eq!(thread.channel_id, channel_id);
            assert_eq!(thread.id, thread_id);
            assert_eq!(thread.thread.reply_count, 1);
            assert_eq!(thread.thread.preview.len(), 1);
            assert_eq!(thread.thread.preview[0].id, reply_id);
        }
    );
}

#[tokio::test]
async fn simple_soup_includes_call_records() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let call_id = Uuid::from_u128(0xca11);
    let channel_id = Uuid::from_u128(0xc4a2);
    let call_query_service = RecordingCallRecordQueryService::new(vec![call_record(
        call_id,
        channel_id,
        user.as_ref(),
        DateTime::default() + Days::new(2),
    )]);

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        call_query_service.clone(),
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters::default(),
            ),
            user: user.clone(),
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert_eq!(call_query_service.calls(), 1);
    assert_eq!(page.items.len(), 1);
    assert_matches!(
        &page.items[0],
        SoupItem::Call(call) => {
            assert_eq!(call.call_id, call_id);
            assert_eq!(call.channel_id, channel_id);
        }
    );
}

#[tokio::test]
async fn simple_soup_uses_channel_thread_filters_without_touching_channel_filters() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let thread_id = Uuid::from_u128(0xbbbb);
    let comms_service = RecordingCommsService::new(Vec::new());

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let _page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        comms_service.clone(),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters {
                    channel_thread_filters: ChannelThreadFilters {
                        thread_ids: vec![thread_id.to_string()],
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert_eq!(comms_service.channel_calls(), 1);
    assert_eq!(comms_service.channel_filters(), vec!["null".to_string()]);
    let thread_filters = comms_service.thread_filters();
    assert_eq!(thread_filters.len(), 1);
    assert!(thread_filters[0].contains("ThreadId"));
    assert!(thread_filters[0].contains(&thread_id.to_string()));
}

#[tokio::test]
async fn simple_soup_includes_foreign_entities() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let foreign_entity_id = Uuid::from_u128(2);
    let foreign_entity_service =
        RecordingForeignEntityService::new(vec![foreign_entity_for_source(
            foreign_entity_id,
            user.as_ref(),
            "user",
            DateTime::default() + Days::new(2),
        )]);

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_updated(
                    "my-document-1",
                    DateTime::default() + Days::new(1),
                ))])
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        foreign_entity_service.clone(),
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters::default(),
            ),
            user: user.clone(),
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert_eq!(page.items.len(), 2);
    assert_matches!(
        &page.items[0],
        SoupItem::ForeignEntity(entity) => assert_eq!(entity.id, foreign_entity_id)
    );
    assert_matches!(&page.items[1], SoupItem::Document(_));

    let calls = foreign_entity_service.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].limit, 20);
    assert_eq!(calls[0].source_ids, vec![SourceId::user(user.as_ref())]);
    assert!(calls[0].query.filter().is_none());
}

#[tokio::test]
async fn frecency_soup_does_not_query_foreign_entities() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let foreign_entity_service =
        RecordingForeignEntityService::new(vec![foreign_entity_for_source(
            Uuid::from_u128(42),
            user.as_ref(),
            "user",
            DateTime::default(),
        )]);

    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecency_page()
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document.with_entity_string(Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            Box::pin(async move { Ok(FrecencyPageResponse::new_mock(iter)) })
        });

    let mut soup = MockSoupRepo::new();
    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|entity| soup_document(&entity.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        foreign_entity_service.clone(),
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap();

    assert!(foreign_entity_service.calls().is_empty());
}

#[tokio::test]
async fn team_receipt_contributes_team_foreign_entity_source_id() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let team_id = Uuid::from_u128(100);
    let foreign_entity_service = RecordingForeignEntityService::new(Vec::new());

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let team_receipt = entity_access::domain::models::EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        user.clone(),
        &team_id.to_string(),
        EntityType::Team,
    );

    SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        foreign_entity_service.clone(),
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters::default(),
            ),
            user: user.clone(),
        },
        Some(team_receipt),
    )
    .await
    .unwrap();

    let calls = foreign_entity_service.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].source_ids,
        vec![
            SourceId::user(user.as_ref()),
            SourceId::new(team_id.to_string(), "team"),
        ]
    );
    assert_eq!(calls[0].requesting_user, Some(user.to_string()));
}

#[tokio::test]
async fn crm_filters_without_team_receipt_are_rejected() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();

    let hidden_companies_filter = EntityFilters {
        crm_company_filters: item_filters::CrmCompanyFilters {
            company_ids: vec![],
            hidden: Some(true),
        },
        ..EntityFilters::default()
    };
    let crm_scope_filter = EntityFilters {
        email_filters: item_filters::EmailFilters {
            crm_domains: vec!["example.com".to_string()],
            ..item_filters::EmailFilters::default()
        },
        ..EntityFilters::default()
    };

    for filters in [hidden_companies_filter, crm_scope_filter] {
        let err = SoupImpl::new(
            MockSoupRepo::new(),
            FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
            NoopEmailPreviewService,
            NoopCommsService,
            NoopCallRecordQueryService,
            NoOpCrmService,
            RecordingForeignEntityService::new(Vec::new()),
            NoOpRemindersService,
        )
        .get_user_soup(
            SoupRequest {
                sort_direction: SoupSortDirection::default(),
                email_preview_view: PreviewView::StandardLabel(
                    email::domain::models::PreviewViewStandardLabel::Inbox,
                ),
                link_ids: vec![],
                soup_type: SoupType::UnExpanded,
                limit: 20,
                cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters),
                user: user.clone(),
            },
            None,
        )
        .await
        .unwrap_err();

        assert!(matches!(err, SoupErr::CrmTeamRequired), "{err:?}");
    }
}

#[tokio::test]
async fn foreign_entity_filter_suppresses_non_matching_foreign_entities() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let foreign_entity_service =
        RecordingForeignEntityService::new(vec![foreign_entity_for_source(
            Uuid::from_u128(1),
            user.as_ref(),
            "user",
            DateTime::default(),
        )]);

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        foreign_entity_service.clone(),
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters {
                    foreign_entity_filters: ForeignEntityFilters {
                        ids: vec![Uuid::from_u128(2).to_string()],
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert!(page.items.is_empty());
    assert!(foreign_entity_service.calls()[0].query.filter().is_some());
}

#[tokio::test]
async fn it_should_not_query_frecency() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .withf(|a| {
            matches!(a.cursor.sort_method(), SimpleSortMethod::ViewedUpdated)
                && assert_matches!(
                    a,
                    SimpleSortRequest {
                        limit: 1,
                        user_id,
                        cursor: SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::ViewedUpdated, ())),
                    } => {
                        assert_eq!(user_id.as_ref(), "macro|test@example.com");
                        true
                    }
                )
        })
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(Some(soup_document("my-document"))
                    .into_iter()
                    .cycle()
                    .take(10)
                    .map(SoupItem::Document)
                    .collect())
            })
        });
    soup_mock.expect_populate_properties().times(0);

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 0,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 1)
}

#[tokio::test]
async fn properties_are_populated_once_after_pagination() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_| {
            Box::pin(async move {
                Ok((0..100)
                    .map(|i| soup_document(&format!("document-{i}")))
                    .map(SoupItem::Document)
                    .collect())
            })
        });
    soup_mock
        .expect_populate_properties()
        .withf(|user_id, items| user_id.as_ref() == "macro|test@example.com" && items.len() == 20)
        .times(1)
        .returning(|_, items| {
            Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                    .collect())
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_properties(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 20);
    assert!(res.items.into_iter().all(|item| {
        item.frecency_score.is_none()
            && match item.item {
                SoupItem::Document(document) => document.extra.properties.is_empty(),
                _ => false,
            }
    }));
}

#[tokio::test]
async fn frecency_is_populated_once_after_pagination() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_| {
            Box::pin(async move {
                Ok((0..100)
                    .map(|i| soup_document(&format!("document-{i}")))
                    .map(SoupItem::Document)
                    .collect())
            })
        });
    soup_mock.expect_populate_properties().times(0);

    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecencies_by_ids()
        .withf(|request| {
            request.user_id.as_ref() == "macro|test@example.com" && request.ids.len() == 20
        })
        .times(1)
        .returning(|request| {
            let scores = request.ids.iter().enumerate().map(|(index, entity)| {
                AggregateFrecency::new_mock(
                    EntityType::Document.with_entity_string(entity.entity_id.to_string()),
                    index as f64 + 1.0,
                )
            });
            let response = FrecencyPageResponse::new_mock(scores);
            Box::pin(async move { Ok(response) })
        });

    let res = SoupImpl::new(
        soup_mock,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 20);
    assert!(res.items.iter().all(|item| item.frecency_score.is_some()));
}

#[tokio::test]
async fn properties_and_frecency_are_composed_after_pagination() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_| {
            Box::pin(async move { Ok(vec![SoupItem::Document(soup_document("document-1"))]) })
        });
    soup_mock
        .expect_populate_properties()
        .withf(|_, items| items.len() == 1)
        .times(1)
        .returning(|_, items| {
            Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                    .collect())
            })
        });

    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecencies_by_ids()
        .withf(|request| request.ids.len() == 1)
        .times(1)
        .returning(|request| {
            let score = AggregateFrecency::new_mock(
                EntityType::Document.with_entity_string(request.ids[0].entity_id.to_string()),
                42.0,
            );
            Box::pin(async move { Ok(FrecencyPageResponse::new_mock([score])) })
        });

    let res = SoupImpl::new(
        soup_mock,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_properties_and_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(
        res.items[0]
            .frecency_score
            .as_ref()
            .map(|score| score.data.frecency_score),
        Some(42.0)
    );
    assert!(match &res.items[0].item {
        SoupItem::Document(document) => document.extra.properties.is_empty(),
        _ => false,
    });
}

#[tokio::test]
async fn grouped_properties_are_populated_by_the_service() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_expanded_grouped_cursor_soup()
        .times(1)
        .returning(|_| {
            Box::pin(async move {
                Ok(vec![ItemGroupingInfo {
                    item: SoupItem::Document(soup_document("grouped-document")),
                    key: "document".to_string(),
                    total_group_count: 1,
                    index_in_group: 1,
                }]
                .into_iter())
            })
        });
    soup_mock
        .expect_populate_properties()
        .withf(|_, items| items.len() == 1)
        .times(1)
        .returning(|_, items| {
            Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                    .collect())
            })
        });

    let service = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    );
    let items = service
        .get_user_soup_grouped(GroupedSortRequest {
            limit: 20,
            cursor: Query::Sort(
                SimpleSortMethod::ViewedUpdated,
                EntityFilterAst::mock_empty(),
            ),
            user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: None,
                per_group_limit: None,
            },
        })
        .await
        .unwrap()
        .collect::<Vec<_>>();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].key, "document");
    assert_eq!(items[0].total_group_count, 1);
    assert_eq!(items[0].index_in_group, 1);
    assert!(match &items[0].item {
        SoupItem::Document(document) => document.extra.properties.is_empty(),
        _ => false,
    });
}

#[tokio::test]
async fn it_should_query_frecency() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|req| {
            assert_eq!(req.user_id.as_ref(), "macro|test@example.com");
            assert_eq!(req.limit, 500);
            true
        })
        .returning(|req| {
            Box::pin(async move {
                Ok((1..=req.limit)
                    .map(|i| {
                        AggregateFrecency::new_mock(
                            EntityType::Document
                                .with_entity_string(uuid::Uuid::from_u128(i as u128).to_string()),
                            420.0,
                        )
                    })
                    .collect())
            })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .withf(|a| {
            assert_matches!(
                a,
                AdvancedSortParams {
                    user_id,
                    entities,
                } => {
                    assert_eq!(user_id.as_ref(), "macro|test@example.com");
                    dbg!(&entities);
                    assert_eq!(entities.len(), 500);
                    true
                }
            )
        })
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .map(|v| soup_document(&v.entity_id))
                .map(SoupItem::Document)
                .collect());
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(frecency_mock),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: u16::MAX,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 500)
}

#[tokio::test]
async fn it_should_sort_frecency_descending() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|req| {
            assert_eq!(req.user_id.as_ref(), "macro|test@example.com");
            assert_eq!(req.limit, 500);
            true
        })
        .returning(|req| {
            Box::pin(async move {
                Ok((1..=req.limit)
                    .map(|v| {
                        AggregateFrecency::new_mock(
                            EntityType::Document
                                .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                            f64::from(v),
                        )
                    })
                    .collect())
            })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .withf(|a| {
            assert_matches!(
                a,
                AdvancedSortParams {
                    user_id,
                    entities,
                } => {
                    assert_eq!(user_id.as_ref(), "macro|test@example.com");
                    assert_eq!(entities.len(), 500);
                    true
                }
            )
        })
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .map(|v| soup_document(&v.entity_id))
                .map(SoupItem::Document)
                .collect());

            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(frecency_mock),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: u16::MAX,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 500);
    assert!(res.items.is_sorted_by_key(|a| {
        std::cmp::Reverse(OrderedFloat(
            a.frecency_score
                .as_ref()
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
        ))
    }));
}

#[tokio::test]
async fn frecency_should_fallback() {
    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|_params| {
            let iter = (1..=25).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v as f64,
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    let mut soup = MockSoupRepo::new();
    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });
    soup.expect_unexpanded_generic_cursor_soup()
        .withf(|params| {
            assert_matches!(
                params,
                SimpleSortRequest {
                    limit: 75,
                    cursor: SimpleSortQuery::FilterFrecency(Query::Sort(SimpleSortMethod::UpdatedAt, Frecency)),
                    ..
                } => {
                    true
                }
            )
        })
        .times(1)
        .returning(|_| {
            let iter = (26..=200)
                .map(|v| {
                    soup_document_with_updated(
                        &uuid::Uuid::from_u128(v as u128).to_string(),
                        DateTime::default() + Days::new(v),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .into_frecency()
    .unwrap();

    // output should be the limit
    assert_eq!(res.items.len(), 100);
    // first 25 items should be frecency
    res.items.get(0..25).unwrap().iter().for_each(|v| {
        assert!(v.frecency_score.is_some());
    });
    // last 75 items should be updated at
    res.items.get(25..100).unwrap().iter().for_each(|v| {
        assert!(v.frecency_score.is_none());
    });
    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();
        assert_eq!(id, expected_uuid_str);
        assert_eq!(updated, <DateTime<Utc>>::default() + Days::new(100));

    });
}

#[tokio::test]
async fn frecency_should_paginate() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .into_frecency()
    .unwrap();

    // output should be the limit
    assert_eq!(res.items.len(), 100);

    // first all items should be frecency
    assert!(
        res.items
            .get(0..100)
            .unwrap()
            .iter()
            .all(|v| v.frecency_score.is_some())
    );

    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }, filter: _} => {
        let expected_uuid_str = Uuid::from_u128(1).to_string();
        assert_eq!(id, expected_uuid_str);
        // last item should be the lowest score because we sort desc
        assert_eq!(score as u32, 1u32);
    });
}

#[tokio::test]
async fn frecency_should_resume_cursor() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    5.0 - (f64::from(v) / params.limit as f64),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_cursor_frecency(CursorWithValAndFilter {
                id: Uuid::from_u128(5),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::FrecencyScore(5.0),
                },
                filter: Default::default(),
            }),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .into_frecency()
    .unwrap();

    // first all items should be frecency
    assert!(
        res.items
            .get(0..100)
            .unwrap()
            .iter()
            .all(|v| v.frecency_score.is_some())
    );

    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }, filter: _} => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();  // "next-100" -> 100
        assert_eq!(id, expected_uuid_str);
        // last item should be the lowest score because we sort desc
        assert_eq!(score as u32, 4u32);
    });
}

#[tokio::test]
async fn frecency_fallback_cursor_should_resume() {
    let frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    soup.expect_unexpanded_generic_cursor_soup()
        .withf(|params| {
            assert_matches!(
                params,
                SimpleSortRequest {
                    limit: 100,
                    cursor: SimpleSortQuery::FilterFrecency(Query::Cursor(Cursor {
                        id,
                        limit: 100,
                        filter: Frecency,
                        val: CursorVal {
                            sort_type: SimpleSortMethod::UpdatedAt,
                            last_val,
                        }
                    })),
                    ..
                } => {
                let expected_time = <DateTime<Utc>>::default() + Days::new(5);
                assert_eq!(last_val, &expected_time);
                let expected_uuid = Uuid::from_u128(100);
                assert_eq!(id, &expected_uuid);
                true
            })
        })
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit * 2)
                .map(|v| {
                    soup_document_with_updated(
                        &uuid::Uuid::from_u128(v as u128).to_string(),
                        DateTime::default() + Days::new(v.into()),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_frecency(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_cursor_frecency(CursorWithValAndFilter {
                id: Uuid::from_u128(100),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::UpdatedAt(DateTime::default() + Days::new(5)),
                },
                filter: Default::default(),
            }),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .into_frecency()
    .unwrap();

    assert!(res.items.iter().all(|v| v.frecency_score.is_none()));
    let cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor, CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();  // "next-100" -> 100
        assert_eq!(id, expected_uuid_str);
        let expected_date = <DateTime<Utc>>::default() + Days::new(100);
        assert_eq!(updated, expected_date);
    })
}

#[tokio::test]
async fn cursor_should_return_simple_sort() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .withf(|a| {
            matches!(a.cursor.sort_method(), SimpleSortMethod::ViewedUpdated)
                && assert_matches!(
                    a,
                    SimpleSortRequest {
                        limit: 1,
                        user_id,
                        cursor: SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::ViewedUpdated, ())),
                    } => {
                        assert_eq!(user_id.as_ref(), "macro|test@example.com");
                        true
                    }
                )
        })
        .times(1)
        .returning(|_params| {
            let res = (0..100)
                .map(|i| soup_document(&format!("my-document-{i}")))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(res) })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 0,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap();

    let simple_cursor = res.into_simple().unwrap();
    let cursor_decoded: CursorWithValAndFilter<String, SimpleSortMethod, EntityFilters> =
        simple_cursor.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor_decoded, CursorWithValAndFilter { id, limit: 1, val: CursorVal { sort_type: SimpleSortMethod::ViewedUpdated, last_val }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(0).to_string();  // "my-document-0" -> 0
        assert_eq!(id, expected_uuid_str);
        let date: DateTime<Utc> = Default::default();
        assert_eq!(last_val, date);
    })
}

#[tokio::test]
async fn cursor_should_return_frecency() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(
        soup,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap();

    let simple_cursor = res.into_frecency().unwrap();
    let cursor_decoded: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        simple_cursor.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor_decoded, CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(1.0) }, filter: _ } => {
        // frecency sort is descending so the last item is id 1
        let expected_uuid_str = Uuid::from_u128(1).to_string();
        assert_eq!(id, expected_uuid_str);
    })
}

/// Helper to extract is_completed from a raw Soup item.
fn get_is_completed(item: &SoupItem<()>) -> Option<bool> {
    match item {
        SoupItem::Document(doc) => doc.sub_type.as_ref().and_then(|st| st.is_task_completed()),
        _ => None,
    }
}

#[tokio::test]
async fn it_should_return_is_completed_true_for_completed_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    Some(true),
                ))])
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 0,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), Some(true));
}

#[tokio::test]
async fn it_should_return_is_completed_false_for_incomplete_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    Some(false),
                ))])
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 0,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), Some(false));
}

#[tokio::test]
async fn it_should_return_is_completed_none_for_non_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    None,
                ))])
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 0,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), None);
}

#[tokio::test]
async fn it_should_preserve_is_completed_for_mixed_items() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(1),
                        Default::default(),
                        Some(true),
                    )),
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(2),
                        Default::default(),
                        Some(false),
                    )),
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(3),
                        Default::default(),
                        None,
                    )),
                ])
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 3,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::ViewedUpdated,
                EntityFilters::default(),
            ),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 3);
    assert_eq!(get_is_completed(&res.items[0]), Some(true));
    assert_eq!(get_is_completed(&res.items[1]), Some(false));
    assert_eq!(get_is_completed(&res.items[2]), None);
}

#[tokio::test]
async fn it_should_preserve_is_completed_in_by_ids_queries() {
    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 3, .. } => true))
        .times(1)
        .returning(|params| {
            // Return 3 items to match the requested limit and avoid fallback
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .enumerate()
                .map(|(idx, v)| {
                    // Set is_completed on first 3 items to test the field
                    let is_completed = match idx {
                        0 => Some(true),
                        1 => Some(false),
                        2 => None,
                        _ => None,
                    };
                    soup_document_with_is_completed(
                        Uuid::parse_str(&v.entity_id).unwrap(),
                        Default::default(),
                        is_completed,
                    )
                })
                .map(SoupItem::Document)
                .collect());
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup_mock,
        frecency,
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![Uuid::new_v4()],
            soup_type: SoupType::UnExpanded,
            limit: 3,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        },
        None,
    )
    .await
    .unwrap()
    .into_frecency()
    .unwrap();

    // Should have 3 items, verify is_completed values are preserved
    assert_eq!(res.items.len(), 3);
    let is_completed_values: Vec<Option<bool>> = res.items.iter().map(get_is_completed).collect();
    // Verify that all three is_completed values (true, false, None) are present
    assert!(
        is_completed_values.contains(&Some(true)),
        "Should contain is_completed=true"
    );
    assert!(
        is_completed_values.contains(&Some(false)),
        "Should contain is_completed=false"
    );
    assert!(
        is_completed_values.contains(&None),
        "Should contain is_completed=None"
    );
}

#[tokio::test]
async fn touched_soup_orders_by_touch_and_drops_unhydrated() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let doc_1 = Uuid::from_u128(1);
    let doc_2 = Uuid::from_u128(2);
    let ghost = Uuid::from_u128(3);
    let project = Uuid::from_u128(4);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_touched_soup_page()
        .times(1)
        .returning(move |req| {
            assert!(req.after.is_none());
            Box::pin(async move {
                Ok(vec![
                    TouchedEntity {
                        entity: EntityType::Document.with_entity_string(doc_1.to_string()),
                        touched_at: base + Days::new(4),
                    },
                    TouchedEntity {
                        entity: EntityType::Project.with_entity_string(project.to_string()),
                        touched_at: base + Days::new(3),
                    },
                    TouchedEntity {
                        entity: EntityType::Document.with_entity_string(ghost.to_string()),
                        touched_at: base + Days::new(2),
                    },
                    TouchedEntity {
                        entity: EntityType::Document.with_entity_string(doc_2.to_string()),
                        touched_at: base + Days::new(1),
                    },
                ])
            })
        });
    // Hydration returns rows in arbitrary order and is missing the ghost;
    // the page must come back in touched order without it.
    soup_mock
        .expect_expanded_soup_by_ids()
        .times(1)
        .returning(move |_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupItem::Document(soup_document_uuid_with_updated(doc_2, Default::default())),
                    SoupItem::Document(soup_document_uuid_with_updated(doc_1, Default::default())),
                ])
            })
        });
    // Projects hydrate through the unexpanded by-ids query even in the
    // expanded feed (the expanded one omits project rows by design).
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(move |params| {
            assert_eq!(params.entities.len(), 1);
            assert_eq!(params.entities[0].entity_type, EntityType::Project);
            Box::pin(async move {
                Ok(vec![SoupItem::Project(models_soup::project::SoupProject {
                    id: project,
                    name: 'p'.to_string(),
                    owner_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                    parent_id: None,
                    created_at: Default::default(),
                    updated_at: Default::default(),
                    viewed_at: Default::default(),
                    deleted_at: None,
                    extra: (),
                })])
            })
        });

    // Identity property hydration: the enriched page is asserted below so
    // the per-item touch timestamps are covered too.
    soup_mock
        .expect_populate_properties()
        .times(1)
        .returning(|_, items| {
            Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                    .collect())
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_properties(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::Expanded,
            limit: 20,
            cursor: SoupQuery::new_sort_touched(EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_touched()
    .unwrap();

    let ids: Vec<Uuid> = page.items.iter().map(|item| item.item.id()).collect();
    assert_eq!(ids, vec![doc_1, project, doc_2]);
    // Every touched item carries its own-mutation timestamp — clients sort
    // and optimistically reorder the feed on it.
    let touched: Vec<_> = page.items.iter().map(|item| item.touched_at).collect();
    assert_eq!(
        touched,
        vec![
            Some(base + Days::new(4)),
            Some(base + Days::new(3)),
            Some(base + Days::new(1)),
        ]
    );
    // Four candidates against a limit of 20: the feed is exhausted.
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn touched_soup_projection_preserves_authoritative_attachment_facts() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let attachment = Uuid::from_u128(1);
    let ordinary_document = Uuid::from_u128(2);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_touched_soup_page()
        .times(1)
        .returning(move |_req| {
            Box::pin(async move {
                Ok(vec![
                    TouchedEntity {
                        entity: EntityType::Document.with_entity_string(attachment.to_string()),
                        touched_at: base + Days::new(2),
                    },
                    TouchedEntity {
                        entity: EntityType::Document
                            .with_entity_string(ordinary_document.to_string()),
                        touched_at: base + Days::new(1),
                    },
                ])
            })
        });
    // Hydration is intentionally out of touched order. The authoritative
    // relation facts must stay attached to their candidates when order is
    // restored; GraphQL uses these values to build cacheProjection.
    soup_mock
        .expect_expanded_soup_by_ids_with_projection()
        .times(1)
        .returning(move |_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupProjectionHydration {
                        item: SoupItem::Document(soup_document_uuid_with_updated(
                            ordinary_document,
                            Default::default(),
                        )),
                        document_server_facts: Some(SoupDocumentServerFacts {
                            is_email_attachment: false,
                            is_important: true,
                            status_option_ids: Vec::new(),
                        }),
                    },
                    SoupProjectionHydration {
                        item: SoupItem::Document(soup_document_uuid_with_updated(
                            attachment,
                            Default::default(),
                        )),
                        document_server_facts: Some(SoupDocumentServerFacts {
                            is_email_attachment: true,
                            is_important: true,
                            status_option_ids: Vec::new(),
                        }),
                    },
                ])
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_projection(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::Expanded,
            limit: 20,
            cursor: SoupQuery::new_sort_touched(EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_touched()
    .unwrap();

    let ids: Vec<Uuid> = page.items.iter().map(|item| item.item.id()).collect();
    assert_eq!(ids, vec![attachment, ordinary_document]);
    assert_eq!(
        page.items[0].document_server_facts,
        Some(SoupDocumentServerFacts {
            is_email_attachment: true,
            is_important: true,
            status_option_ids: Vec::new(),
        })
    );
    assert_eq!(
        page.items[1].document_server_facts,
        Some(SoupDocumentServerFacts {
            is_email_attachment: false,
            is_important: true,
            status_option_ids: Vec::new(),
        })
    );
}

/// Unexpanded touched pages hydrate projects through the main by-ids query —
/// one round trip, not a separate project query (that split exists only for
/// the expanded feed, whose by-ids query omits project rows by design).
#[tokio::test]
async fn unexpanded_touched_hydrates_projects_in_the_main_query() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let doc = Uuid::from_u128(1);
    let project = Uuid::from_u128(2);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_touched_soup_page()
        .times(1)
        .returning(move |_req| {
            Box::pin(async move {
                Ok(vec![
                    TouchedEntity {
                        entity: EntityType::Document.with_entity_string(doc.to_string()),
                        touched_at: base + Days::new(2),
                    },
                    TouchedEntity {
                        entity: EntityType::Project.with_entity_string(project.to_string()),
                        touched_at: base + Days::new(1),
                    },
                ])
            })
        });
    // Exactly one by-ids call, carrying the document AND the project.
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .withf(move |params| {
            params.entities.len() == 2
                && params
                    .entities
                    .iter()
                    .any(|e| e.entity_type == EntityType::Project)
        })
        .times(1)
        .returning(move |_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupItem::Document(soup_document_uuid_with_updated(doc, Default::default())),
                    SoupItem::Project(models_soup::project::SoupProject {
                        id: project,
                        name: 'p'.to_string(),
                        owner_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                        parent_id: None,
                        created_at: Default::default(),
                        updated_at: Default::default(),
                        viewed_at: Default::default(),
                        deleted_at: None,
                        extra: (),
                    }),
                ])
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_touched(EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_touched()
    .unwrap();

    let ids: Vec<Uuid> = page.items.iter().map(|item| item.id()).collect();
    assert_eq!(ids, vec![doc, project]);
}

#[tokio::test]
async fn touched_soup_full_page_builds_keyset_cursor() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let base: DateTime<Utc> = DateTime::default();
    let ids: Vec<Uuid> = (1..=20).map(Uuid::from_u128).collect();
    let last_id = *ids.last().unwrap();
    let last_touch = base + Days::new(1);

    let mut soup_mock = MockSoupRepo::new();
    let touched_ids = ids.clone();
    soup_mock
        .expect_touched_soup_page()
        .times(1)
        .returning(move |_req| {
            let rows = touched_ids
                .iter()
                .enumerate()
                .map(|(i, id)| TouchedEntity {
                    entity: EntityType::Document.with_entity_string(id.to_string()),
                    touched_at: base + Days::new(20 - i as u64),
                })
                .collect();
            Box::pin(async move { Ok(rows) })
        });
    let hydrated_ids = ids.clone();
    soup_mock
        .expect_expanded_soup_by_ids()
        .times(1)
        .returning(move |_params| {
            let items = hydrated_ids
                .iter()
                .map(|id| {
                    SoupItem::Document(soup_document_uuid_with_updated(*id, Default::default()))
                })
                .collect();
            Box::pin(async move { Ok(items) })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![],
            soup_type: SoupType::Expanded,
            limit: 20,
            cursor: SoupQuery::new_sort_touched(EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap()
    .into_touched()
    .unwrap();

    assert_eq!(page.items.len(), 20);
    // A full candidate page continues from the last row's keyset position.
    let decoded: CursorWithValAndFilter<String, models_pagination::TouchedByMe, EntityFilters> =
        page.next_cursor.unwrap().decode_json().unwrap();
    assert_eq!(decoded.id, last_id.to_string());
    assert_eq!(decoded.val.last_val, last_touch);
}

/// Records each email hydration request and returns no threads.
#[derive(Clone, Default)]
struct RecordingEmailPreviewService {
    requests: Arc<Mutex<Vec<(PreviewView, Vec<Uuid>, Option<u32>)>>>,
    filters: Arc<Mutex<Vec<String>>>,
}

impl EmailPreviewServiceReadOnly for RecordingEmailPreviewService {
    async fn get_email_thread_previews(
        &self,
        req: email::domain::models::GetEmailsRequest,
    ) -> Result<
        PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
        email::domain::models::EmailErr,
    > {
        self.requests
            .lock()
            .unwrap()
            .push((req.view.clone(), req.link_ids.clone(), req.limit));
        self.filters
            .lock()
            .unwrap()
            .push(serde_json::to_string(req.query.filter()).unwrap());
        Ok(Option::<EnrichedEmailThreadPreview>::None
            .into_iter()
            .paginate_on(0, SimpleSortMethod::CreatedAt)
            .into_page())
    }
}

/// Records the id sets and limits the reminders leg is asked for.
#[derive(Default)]
struct RecordingRemindersService {
    queries: Arc<Mutex<Vec<(Vec<Uuid>, i64)>>>,
}

impl RemindersService for RecordingRemindersService {
    async fn create_reminder(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _request: CreateReminder,
        _entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("RecordingRemindersService.create_reminder")
    }

    async fn get_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("RecordingRemindersService.get_reminder")
    }

    async fn list_reminders(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _filter: ReminderFilter,
    ) -> Result<ReminderPage, ReminderError> {
        unimplemented!("RecordingRemindersService.list_reminders")
    }

    async fn list_reminders_for_soup(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, ReminderError> {
        self.queries
            .lock()
            .unwrap()
            .push((query.ids.to_vec(), query.limit));
        Ok(Vec::new())
    }

    async fn update_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _patch: ReminderPatch,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("RecordingRemindersService.update_reminder")
    }

    async fn delete_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ReminderError> {
        unimplemented!("RecordingRemindersService.delete_reminder")
    }
}

/// Touched email hydration must use the unfiltered `All` view: the candidate
/// query admits threads the caller's display view (e.g. Inbox) would hide,
/// and a view-filtered hydration would silently drop them from the page.
#[tokio::test]
async fn touched_soup_hydrates_emails_with_the_unfiltered_view() {
    let user = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let thread = Uuid::from_u128(7);
    let link = Uuid::from_u128(8);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_touched_soup_page()
        .times(1)
        .returning(move |_req| {
            Box::pin(async move {
                Ok(vec![TouchedEntity {
                    entity: EntityType::EmailThread.with_entity_string(thread.to_string()),
                    touched_at: base + Days::new(1),
                }])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let email_service = RecordingEmailPreviewService::default();
    let requests = email_service.requests.clone();

    let _page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        email_service,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_ids: vec![link],
            soup_type: SoupType::Expanded,
            limit: 20,
            cursor: SoupQuery::new_sort_touched(EntityFilters::default()),
            user,
        },
        None,
    )
    .await
    .unwrap();

    let recorded = requests.lock().unwrap();
    let (view, link_ids, limit) = recorded.first().expect("email hydration ran");
    assert_eq!(
        view,
        &PreviewView::StandardLabel(email::domain::models::PreviewViewStandardLabel::All)
    );
    assert_eq!(link_ids, &vec![link]);
    assert_eq!(limit, &Some(1));
}

/// Channel and email filter trees fold in their own domains; combining them
/// with touched_by_me is rejected rather than silently dropping the type.
#[tokio::test]
async fn touched_soup_rejects_unfoldable_filters() {
    for (filters, expected_kind) in [
        (
            EntityFilters {
                channel_filters: item_filters::ChannelFilters {
                    importance: Some(true),
                    ..Default::default()
                },
                ..Default::default()
            },
            "channel",
        ),
        (
            EntityFilters {
                email_filters: item_filters::EmailFilters {
                    importance: Some(true),
                    ..Default::default()
                },
                ..Default::default()
            },
            "email",
        ),
    ] {
        let mut soup_mock = MockSoupRepo::new();
        soup_mock.expect_touched_soup_page().times(0);

        let err = SoupImpl::new(
            soup_mock,
            FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
            NoopEmailPreviewService,
            RecordingCommsService::new(vec![]),
            NoopCallRecordQueryService,
            NoOpCrmService,
            NoopForeignEntityService,
            NoOpRemindersService,
        )
        .get_user_soup(
            SoupRequest {
                sort_direction: SoupSortDirection::default(),
                email_preview_view: PreviewView::StandardLabel(
                    email::domain::models::PreviewViewStandardLabel::Inbox,
                ),
                link_ids: vec![],
                soup_type: SoupType::Expanded,
                limit: 20,
                cursor: SoupQuery::new_sort_touched(filters),
                user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
            },
            None,
        )
        .await
        .unwrap_err();

        assert_matches!(err, SoupErr::TouchedUnsupportedFilter(kind) => {
            assert_eq!(kind, expected_kind);
        });
    }
}

fn notified_request(
    limit: u16,
    link_ids: Vec<Uuid>,
    filters: EntityFilters,
) -> SoupRequest<EntityFilters> {
    SoupRequest {
        sort_direction: SoupSortDirection::default(),
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_ids,
        soup_type: SoupType::Expanded,
        limit,
        cursor: SoupQuery::new_sort_notified(filters),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    }
}

fn notified(entity_type: EntityType, id: Uuid, notified_at: DateTime<Utc>) -> NotifiedEntity {
    NotifiedEntity {
        entity: entity_type.with_entity_string(id.to_string()),
        notified_at,
    }
}

/// A candidate that fails hydration is dropped and the page refills from the
/// next candidate page, in notification order, until the candidates run out.
#[tokio::test]
async fn notified_soup_refills_after_hydration_drops_and_ends_when_exhausted() {
    let doc_1 = Uuid::from_u128(1);
    let ghost = Uuid::from_u128(2);
    let project = Uuid::from_u128(3);
    let doc_2 = Uuid::from_u128(4);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_notified_soup_page()
        .times(2)
        .returning(move |req| {
            assert_eq!(req.limit, 3);
            // Round one is a full candidate page; the ghost never hydrates,
            // so round two resumes after the last walked candidate and is
            // short, which ends the feed.
            let rows = match req.after {
                None => vec![
                    notified(EntityType::Document, doc_1, base + Days::new(5)),
                    notified(EntityType::Document, ghost, base + Days::new(4)),
                    notified(EntityType::Project, project, base + Days::new(3)),
                ],
                Some(after) => {
                    assert_eq!(after.entity_id, project.to_string());
                    assert_eq!(after.notified_at, base + Days::new(3));
                    vec![notified(EntityType::Document, doc_2, base + Days::new(2))]
                }
            };
            Box::pin(async move { Ok(rows) })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .times(2)
        .returning(move |params| {
            let items: Vec<SoupItem<()>> = params
                .entities
                .iter()
                .filter_map(|entity| {
                    let id = Uuid::parse_str(&entity.entity_id).unwrap();
                    (id != ghost).then(|| {
                        SoupItem::Document(soup_document_uuid_with_updated(id, Default::default()))
                    })
                })
                .collect();
            Box::pin(async move { Ok(items) })
        });
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(move |params| {
            assert_eq!(params.entities.len(), 1);
            Box::pin(async move {
                Ok(vec![SoupItem::Project(models_soup::project::SoupProject {
                    id: project,
                    name: 'p'.to_string(),
                    owner_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                    parent_id: None,
                    created_at: Default::default(),
                    updated_at: Default::default(),
                    viewed_at: Default::default(),
                    deleted_at: None,
                    extra: (),
                })])
            })
        });
    soup_mock
        .expect_populate_properties()
        .times(1)
        .returning(|_, items| {
            Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                    .collect())
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup_with_properties(notified_request(3, vec![], EntityFilters::default()), None)
    .await
    .unwrap()
    .into_notified()
    .unwrap();

    let ids: Vec<Uuid> = page.items.iter().map(|item| item.item.id()).collect();
    assert_eq!(ids, vec![doc_1, project, doc_2]);
    // Every item carries the notification timestamp it was ordered on.
    let notified_at: Vec<_> = page.items.iter().map(|item| item.notified_at).collect();
    assert_eq!(
        notified_at,
        vec![
            Some(base + Days::new(5)),
            Some(base + Days::new(3)),
            Some(base + Days::new(2)),
        ]
    );
    // The second candidate page was short and fully consumed: feed exhausted.
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn notified_soup_full_page_builds_keyset_cursor() {
    let doc_1 = Uuid::from_u128(1);
    let doc_2 = Uuid::from_u128(2);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_notified_soup_page()
        .times(1)
        .returning(move |_req| {
            Box::pin(async move {
                Ok(vec![
                    notified(EntityType::Document, doc_1, base + Days::new(5)),
                    notified(EntityType::Document, doc_2, base + Days::new(4)),
                ])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .times(1)
        .returning(move |_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupItem::Document(soup_document_uuid_with_updated(doc_1, Default::default())),
                    SoupItem::Document(soup_document_uuid_with_updated(doc_2, Default::default())),
                ])
            })
        });

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(notified_request(2, vec![], EntityFilters::default()), None)
    .await
    .unwrap()
    .into_notified()
    .unwrap();

    assert_eq!(page.items.len(), 2);
    // A full candidate page continues from the last walked candidate.
    let decoded: CursorWithValAndFilter<String, models_pagination::NotifiedAt, EntityFilters> =
        page.next_cursor.unwrap().decode_json().unwrap();
    assert_eq!(decoded.id, doc_2.to_string());
    assert_eq!(decoded.val.last_val, base + Days::new(4));
}

/// A run of candidates that all fail hydration must not loop forever: the
/// refill stops after the round cap and hands back a cursor so the client
/// can keep going.
#[tokio::test]
async fn notified_soup_caps_refill_rounds_and_keeps_a_cursor() {
    let ghost = Uuid::from_u128(9);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    let mut rounds = 0u64;
    soup_mock
        .expect_notified_soup_page()
        .times(MAX_NOTIFIED_FILL_ROUNDS)
        .returning(move |_req| {
            rounds += 1;
            let rows = vec![notified(
                EntityType::Document,
                ghost,
                base + Days::new(10 - rounds),
            )];
            Box::pin(async move { Ok(rows) })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .times(MAX_NOTIFIED_FILL_ROUNDS)
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(notified_request(1, vec![], EntityFilters::default()), None)
    .await
    .unwrap()
    .into_notified()
    .unwrap();

    assert!(page.items.is_empty());
    let decoded: CursorWithValAndFilter<String, models_pagination::NotifiedAt, EntityFilters> =
        page.next_cursor.unwrap().decode_json().unwrap();
    assert_eq!(decoded.id, ghost.to_string());
    assert_eq!(
        decoded.val.last_val,
        base + Days::new(10 - MAX_NOTIFIED_FILL_ROUNDS as u64)
    );
}

/// Channel, channel-thread and email candidates hydrate through their own
/// legs with the request's tree ANDed onto the page's ids, under the
/// request's own view, so every such filter keeps applying to the notified
/// feed.
#[tokio::test]
async fn notified_soup_hydrates_channels_and_emails_with_the_request_tree() {
    let channel = Uuid::from_u128(5);
    let channel_thread = Uuid::from_u128(6);
    let thread = Uuid::from_u128(7);
    let link = Uuid::from_u128(8);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_notified_soup_page()
        .times(1)
        .returning(move |req| {
            assert!(req.hydratable.channels);
            assert!(req.hydratable.channel_threads);
            assert!(req.hydratable.email_threads);
            assert!(!req.hydratable.reminders);
            Box::pin(async move {
                Ok(vec![
                    notified(EntityType::Channel, channel, base + Days::new(3)),
                    notified(
                        EntityType::ChannelMessage,
                        channel_thread,
                        base + Days::new(2),
                    ),
                    notified(EntityType::EmailThread, thread, base + Days::new(1)),
                ])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let email_service = RecordingEmailPreviewService::default();
    let email_requests = email_service.requests.clone();
    let email_filters = email_service.filters.clone();
    let comms_service = RecordingCommsService::new(vec![]);

    let filters = EntityFilters {
        channel_filters: item_filters::ChannelFilters {
            notification_filters: item_filters::NotificationFilters {
                done: Some(false),
                ..Default::default()
            },
            ..Default::default()
        },
        channel_thread_filters: ChannelThreadFilters {
            participant_ids: vec!["macro|test@example.com".to_string()],
            ..Default::default()
        },
        email_filters: item_filters::EmailFilters {
            importance: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };
    let _page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        email_service,
        comms_service.clone(),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(notified_request(20, vec![link], filters), None)
    .await
    .unwrap();

    let channel_filters = comms_service.channel_filters();
    assert_eq!(channel_filters.len(), 1);
    assert!(channel_filters[0].contains("ChannelId"));
    assert!(channel_filters[0].contains(&channel.to_string()));
    assert!(channel_filters[0].contains("NotificationDone"));

    let thread_filters = comms_service.thread_filters();
    assert_eq!(thread_filters.len(), 1);
    assert!(thread_filters[0].contains("ThreadId"));
    assert!(thread_filters[0].contains(&channel_thread.to_string()));
    assert!(thread_filters[0].contains("Participant"));

    let recorded = email_requests.lock().unwrap();
    let (view, link_ids, limit) = recorded.first().expect("email hydration ran");
    // The request's own view, not the touched feed's unfiltered `All`.
    assert_eq!(
        view,
        &PreviewView::StandardLabel(email::domain::models::PreviewViewStandardLabel::Inbox)
    );
    assert_eq!(link_ids, &vec![link]);
    assert_eq!(limit, &Some(1));
    let email_filters = email_filters.lock().unwrap();
    assert!(email_filters[0].contains(&thread.to_string()));
    assert!(email_filters[0].contains("Importance"));
}

fn reminder_id_filters(ids: &[Uuid]) -> EntityFilters {
    EntityFilters {
        reminder_filters: item_filters::ReminderFilters {
            include: true,
            ids: ids.iter().map(Uuid::to_string).collect(),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// A request naming reminder ids hydrates only the page candidates among
/// them: the leg is asked for the intersection.
#[tokio::test]
async fn notified_soup_narrows_the_reminder_leg_to_the_request_ids() {
    let named = Uuid::from_u128(11);
    let unnamed = Uuid::from_u128(12);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_notified_soup_page()
        .times(1)
        .returning(move |req| {
            assert!(req.hydratable.reminders);
            Box::pin(async move {
                Ok(vec![
                    notified(EntityType::Reminder, named, base + Days::new(2)),
                    notified(EntityType::Reminder, unnamed, base + Days::new(1)),
                ])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let reminders_service = RecordingRemindersService::default();
    let queries = reminders_service.queries.clone();

    let _page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        reminders_service,
    )
    .get_user_soup(
        notified_request(20, vec![], reminder_id_filters(&[named])),
        None,
    )
    .await
    .unwrap();

    assert_eq!(*queries.lock().unwrap(), vec![(vec![named], 1)]);
}

/// When no page candidate is among the named ids the leg is skipped: an
/// empty id list means every reminder to the reminders service, which would
/// hydrate — and surface — the candidates the request excluded.
#[tokio::test]
async fn notified_soup_skips_the_reminder_leg_when_no_candidate_is_named() {
    let named = Uuid::from_u128(11);
    let unnamed = Uuid::from_u128(12);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_notified_soup_page()
        .times(1)
        .returning(move |_req| {
            Box::pin(async move {
                Ok(vec![notified(
                    EntityType::Reminder,
                    unnamed,
                    base + Days::new(1),
                )])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids()
        .returning(|_params| Box::pin(async move { Ok(Vec::new()) }));

    let reminders_service = RecordingRemindersService::default();
    let queries = reminders_service.queries.clone();

    let page = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        reminders_service,
    )
    .get_user_soup(
        notified_request(20, vec![], reminder_id_filters(&[named])),
        None,
    )
    .await
    .unwrap()
    .into_notified()
    .unwrap();

    assert!(queries.lock().unwrap().is_empty());
    assert!(page.items.is_empty());
}

/// Calendar events hydrate by id through the main query, so only the
/// calendar literals the candidate query can fold are accepted.
#[tokio::test]
async fn notified_soup_rejects_unfoldable_calendar_filters() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock.expect_notified_soup_page().times(0);

    let filters = EntityFilters {
        calendar_event_filters: item_filters::CalendarEventFilters {
            organizers: vec!["organizer@example.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let err = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopForeignEntityService,
        NoOpRemindersService,
    )
    .get_user_soup(notified_request(20, vec![], filters), None)
    .await
    .unwrap_err();

    assert_matches!(err, SoupErr::NotifiedUnsupportedFilter("calendar_event"));
}
