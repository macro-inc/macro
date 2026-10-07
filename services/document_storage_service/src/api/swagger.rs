#![allow(
    deprecated,
    reason = "Just to allow GetActivitiesResponse and UserActivitiesResponse"
)]

use crate::api::saved_views::{
    CreateViewRequest, ExcludeDefaultViewRequest, ExcludedDefaultView, View, ViewPatch,
};
use crate::{
    api::{
        annotations,
        documents::{
            self,
            export_document::ExportDocumentResponse,
            permissions_token::{
                create_permission_token::DocumentPermissionsTokenResponse,
                validate_permissions_token::DocumentPermissionsTokenRequest,
            },
        },
        entity, health, history, instructions, pins,
        recents::{
            self,
            recently_deleted::{RecentlyDeletedResponse, RecentlyDeletedResponseData},
        },
        saved_views, threads, user_document_view_location,
    },
    model::{
        request::{
            documents::{
                preview::GetBatchPreviewRequest,
                save::{PreSaveDocumentRequest, SaveDocumentRequest},
                user_document_view_location::UpsertUserDocumentViewLocationRequest,
            },
            pins::{AddPinRequest, PinRequest},
        },
        response::{
            documents::{
                create::{CreateBulkDocumentResponse, CreateBulkDocumentResponseData},
                get::{
                    GetDocumentKeyResponse, GetDocumentKeyResponseData,
                    GetDocumentPermissionsResponseDataV2, GetDocumentProcessingResult,
                    GetDocumentProcessingResultResponse, GetDocumentSearchResponse,
                    GetDocumentUserAccessLevelResponse, GetDocumentsResponse,
                    UserDocumentsResponse,
                },
                preview::GetBatchPreviewResponse,
                save::{
                    PreSaveDocumentResponse, PreSaveDocumentResponseData, SaveDocumentResponse,
                    SaveDocumentResponseData,
                },
                user_document_view_location::UserDocumentViewLocationResponse,
            },
            history::GetUserHistoryResponse,
            instructions::{CreateInstructionsDocumentResponse, GetInstructionsDocumentResponse},
            pin::{GetPinsResponse, UserPinsResponse},
            user_views::UserViewsResponse,
        },
    },
};
use channel_labels::domain::models::{
    ChannelLabel, ChannelLabelRule, ChannelLabelsList, SmartTagChannelMatch, SmartTagPreview,
};
use channel_labels::inbound::axum_router::{
    CreateChannelLabelRequest, RenameChannelLabelRequest, SetChannelLabelRequest,
};
use channels::inbound::axum_router::{
    ApiActivity, ApiAttachmentChannelReference, ApiAttachmentEntityReference,
    ApiAttachmentGenericReference, ApiChannelAttachment, ApiChannelAttachmentsPage,
    ApiChannelDetail, ApiChannelParticipant, ApiParticipantRole, CreateEntityMentionRequest,
    CreateEntityMentionResponse, DeleteEntityMentionResponse, GetAttachmentReferencesResponse,
    PostActivityRequest,
};
use collab_surface::domain::models::SurfaceState;
use collab_surface::inbound::axum_router::{
    CollabSurfaceResponse, CollabSurfaceTokenResponse, EnsureCollabSurfaceRequest,
};
use databases::domain::journal::{
    ColumnChangeKind as DatabaseColumnChangeKind, RowChangeKind as DatabaseRowChangeKind,
    RowHistoryEntry as DatabaseRowHistoryEntry, SkippedCell as DatabaseSkippedCell,
    TableChanges as DatabaseTableChanges, TouchedColumn as DatabaseTouchedColumn,
    TouchedRow as DatabaseTouchedRow, UndoOutcome as DatabaseUndoOutcome,
    UndoRefusal as DatabaseUndoRefusal,
};
use databases::domain::models::CommittedChange as DatabaseCommittedChange;
use databases::domain::models::{
    Awareness as DatabaseAwareness, Column as DatabaseColumn, ColumnConfig as DatabaseColumnConfig,
    ColumnDetail as DatabaseColumnDetail, Database, DatabaseDetail, ListedDatabase,
    QueryDefinition as DatabaseQueryDefinition, SavedQuery as DatabaseSavedQuery,
    Table as DatabaseTable, TableDetail as DatabaseTableDetail,
    TableVersion as DatabaseTableVersion,
};
use databases::inbound::axum_router::history::{
    RowHistoryResponse as DatabaseRowHistoryResponse,
    UndoChangeResponse as DatabaseUndoChangeResponse,
};
use databases::inbound::axum_router::ops::{
    ApplyOpsRequest as DatabaseApplyOpsRequest, ApplyOpsResponse as DatabaseApplyOpsResponse,
    OpRefusalResponse as DatabaseOpRefusalResponse,
};
use databases::inbound::axum_router::views::ViewPositionsResponse as DatabaseViewPositionsResponse;
use databases::inbound::axum_router::{
    CreateDatabaseRequest, saved_queries::SaveQueryRequest as DatabaseSaveQueryRequest,
};
use databases::outbound::gateway_event_publisher::{
    AwarenessRelay as DatabaseAwarenessRelay, TableChanged as DatabaseTableChanged,
};
use document_sub_type::DocumentSubType;
use documents_hex::inbound::axum_router::{
    edit_document::EditDocumentResponse, get_branch_name::BranchNameResponse,
    get_short_id::ShortIdResponse,
};
use favorites::domain::models::{Favorite, FavoritesList};
use favorites::inbound::axum_router::{
    AddFavoriteRequest, FavoriteEntityRef, ReorderFavoritesRequest,
};
use foreign_entity::domain::models::ForeignEntity;
use github_pull_requests::domain::models::{
    GithubLabelFacet, GithubPullRequestFacets, GithubRepositoryFacet, GithubUserFacet,
    StoredGithubPullRequest,
};
use github_pull_requests::inbound::changes_router::{
    ChangedFileDto, ChangesetDto, ChangesetSourceDto, FileChangeKindDto, GitRefDto,
    GithubPullRequestChangesPatchResponse, GithubPullRequestChangesResponse,
};
use initiative::domain::models::{
    CreateInitiativeRequest, InitialPropertyValue, InitiativeDetail, InitiativeId, InitiativeList,
    InitiativeSummary, UpdateInitiativeRequest,
};
use model::document::response::{
    CreateDocumentRequest, CreateDocumentResponse, CreateDocumentResponseData,
    DocumentResponseMetadata,
};
use model::{
    annotations::AnnotationIncrementalUpdate,
    chat::Chat,
    document::{
        BasicDocument, BomPart, DocumentMetadata, DocumentPermissionsToken, FileType, SaveBomPart,
        response::{
            GetDocumentListResult, GetDocumentResponse, GetDocumentResponseData,
            LocationResponseData,
        },
    },
    item::{CloudStorageItemType, Item, ItemWithUserAccessLevel},
    pin::{PinnedItem, request::ReorderPinRequest},
    project::{
        Project,
        request::{CreateProjectRequest, GetBatchProjectPreviewRequest, PatchProjectRequestV2},
        response::{
            CreateProjectResponse, GetBatchProjectPreviewResponse, GetProjectContentResponse,
            GetProjectResponse, GetProjectResponseData, GetProjectsResponse,
        },
    },
    response::{
        GenericErrorResponse, GenericResponse, GenericSuccessResponse, PresignedUrl,
        SuccessResponse,
    },
    sync_service::SyncServiceVersionID,
    user_document_view_location::UserDocumentViewLocation,
    version::DocumentStorageServiceApiVersion,
};
use models_databases::views::{
    CardPosition as DatabaseCardPosition, Conjunction as DatabaseFilterConjunction, DatabaseView,
    DateOperator as DatabaseDateOperator, FilterCondition as DatabaseFilterCondition,
    FilterGroup as DatabaseFilterGroup, FilterNode as DatabaseFilterNode,
    FilterTest as DatabaseFilterTest, Lane as DatabaseBoardLane, LaneKey as DatabaseLaneKey,
    NewView as DatabaseNewView, NumberOperator as DatabaseNumberOperator,
    PresenceOperator as DatabasePresenceOperator, RequestedLayout as DatabaseRequestedLayout,
    SetOperator as DatabaseSetOperator, SortDirection as DatabaseSortDirection,
    SortKey as DatabaseSortKey, TextOperator as DatabaseTextOperator,
    ViewColumn as DatabaseViewColumn, ViewLayout as DatabaseViewLayout,
    ViewPosition as DatabaseViewPosition, ViewQuery as DatabaseViewQuery,
};
use models_databases::{
    CellValue as DatabaseCellValue, CellWrite as DatabaseCellWrite,
    ColumnChange as DatabaseColumnChange, ColumnKind as DatabaseColumnKind,
    ColumnResult as DatabaseColumnResult, DatabaseOp, EntityKind as DatabaseEntityKind,
    EntityRef as DatabaseEntityRef, NewColumn as DatabaseNewColumn, NewOption as DatabaseNewOption,
    OpResult as DatabaseOpResult, OptionRef as DatabaseOptionRef, RowChange as DatabaseRowChange,
    RowChanges as DatabaseRowChanges, RowsChange as DatabaseRowsChange,
    RowsResult as DatabaseRowsResult, TableChange as DatabaseTableChange,
    TableResult as DatabaseTableResult, TakenId as DatabaseTakenId,
    VersionedTable as DatabaseVersionedTable, ViewChange as DatabaseViewChange,
    ViewResult as DatabaseViewResult,
};
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use models_soup::call_record::{SoupCallRecord, SoupCallRecordParticipant};
use models_soup::chat::SoupChat;
use models_soup::document::SoupDocument;
use models_soup::email_thread::{
    SoupAttachment, SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview, SoupLabel,
    SoupLabelListVisibility, SoupLabelType, SoupMessageListVisibility,
};
use models_soup::foreign_entity::SoupForeignEntity;
use models_soup::project::SoupProject;
use projects_hex::inbound::axum_router::delete_project::{
    ProjectDeleteResponse, ProjectDeleteResponseData,
};
use soup::domain::models::{SoupItemWithProperties, SoupPropertiesField};
use soup::inbound::axum_router::{
    ApiGroupByField, ApiGroupMeta, GroupedSoupGroupPage, GroupedSoupInitialPage, GroupedSoupPage,
    PostGroupedSoupAstGroupPageRequest, PostGroupedSoupAstInitialRequest,
    PostGroupedSoupAstRequest, PostSoupAstRequest, PostSoupRequest, SoupApiItem, SoupApiSort,
    SoupPage,
};
use user_api_key::domain::models::{CreatedUserApiKey, UserApiKeyInfo};
use user_api_key::inbound::axum_router::{CreateUserApiKeyRequest, UserApiKeysList};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    modifiers(&FormsApiAddon),
    paths(
        dictation::inbound::axum_router::transcribe_handler,
        health::health_handler,
        calendar_events::inbound::axum_router::list_occurrences,
        calendar_events::inbound::axum_router::mention_previews,
        calendar_events::inbound::axum_router::list_team_out_of_office,

        // annotations
        annotations::get::get_document_anchors_handler,
        annotations::delete_anchor::delete_anchor_handler,
        annotations::edit_anchor::edit_anchor_handler,
        annotations::create_anchor::create_anchor_handler,

        // documents
        documents::get_user_documents::get_user_documents_handler,
        documents::get_starter_docs::handler,
        documents_hex::inbound::axum_router::get_document::get_document_handler,
        documents_hex::inbound::axum_router::get_document_by_team_slug::get_document_by_team_slug_handler,
        documents::get_document_version::handler,
        documents_hex::inbound::axum_router::create_document::create_document_handler,
        documents_hex::inbound::axum_router::create_markdown::create_markdown_handler,
        documents_hex::inbound::axum_router::copy_document::copy_document_handler,
        documents::save_document::save_document_handler,
        documents::pre_save::presave_document_handler,
        documents_hex::inbound::axum_router::edit_document::edit_document_handler,
        documents_hex::inbound::axum_router::delete_document::delete_document_handler,
        documents::delete_document::permanently_delete_document_handler,
        documents::get_document_list::get_document_list_handler,
        documents::get_document_permissions::get_document_permissions_handler_v2,
        documents::get_document_views::get_document_views_handler,
        documents::location::get_location_handler,
        documents_hex::inbound::axum_router::get_location::get_location_v3_handler,
        documents_hex::inbound::axum_router::get_branch_name::get_branch_name_handler,
        documents_hex::inbound::axum_router::get_github_pull_requests::get_github_pull_requests_handler,
        documents_hex::inbound::axum_router::get_short_id::get_short_id_handler,
        documents::simple_save::handler,
        documents::initialize_user_documents::handler,
        documents::get_batch_preview::get_batch_preview_handler,
        documents::permissions_token::create_permission_token::handler,
        documents::permissions_token::validate_permissions_token::handler,
        documents::revert_delete_document::handler,
        documents::export_document::handler,
        documents_hex::inbound::axum_router::create_task::create_task_handler,
        documents_hex::inbound::axum_router::create_snippet::create_snippet_handler,
        documents_hex::inbound::axum_router::create_skill::create_skill_handler,
        documents_hex::inbound::axum_router::system_skills::get_system_skills_handler,
        documents_hex::inbound::axum_router::team_share::get_team_share_handler,
        documents_hex::inbound::axum_router::team_share::set_team_share_handler,

        // instructions
        instructions::create_instructions::create_instructions_handler,
        instructions::get_instructions::get_instructions_handler,

        // user_document_view_location
        user_document_view_location::get_user_document_view_location::handler,
        user_document_view_location::upsert_user_document_view_location::handler,
        user_document_view_location::delete_user_document_view_location::handler,

        // processing
        documents::job_processing_result::job_processing_result_handler,
        documents::get_document_processing_result::handler,

        // history
        history::get_history::get_history_handler,
        history::upsert_history::upsert_history_handler,
        history::delete_history::delete_history_handler,

        // items
        soup::inbound::axum_router::get_soup_handler,
        soup::inbound::axum_router::post_soup_handler,
        soup::inbound::axum_router::post_soup_ast_handler,
        soup::inbound::axum_router::post_grouped_soup_ast_handler,

        // channel list (comms hex)
        channels::inbound::list_router::get_channels_handler,

        // messages (channels and documents)
        messages::inbound::axum_router::timeline,
        messages::inbound::axum_router::create,
        messages::inbound::axum_router::get_message,
        messages::inbound::axum_router::edit,
        messages::inbound::axum_router::delete_message,
        messages::inbound::axum_router::react,
        messages::inbound::axum_router::get_thread,
        messages::inbound::axum_router::patch_thread,
        messages::inbound::axum_router::delete_thread,
        messages::inbound::axum_router::typing,
        messages::inbound::axum_router::legacy,

        // channels
        channels::inbound::axum_router::create_channel_handler,
        channels::inbound::axum_router::get_or_create_dm_handler,
        channels::inbound::axum_router::get_or_create_private_handler,
        channels::inbound::axum_router::patch_channel_handler,
        channels::inbound::axum_router::profile_picture::set_channel_picture_handler,
        channels::inbound::axum_router::delete_channel_handler,
        channels::inbound::axum_router::add_participants_handler,
        channels::inbound::axum_router::remove_participants_handler,
        channels::inbound::axum_router::get_channel_join_link_handler,
        channels::inbound::axum_router::join_channel_by_code_handler,
        channels::inbound::axum_router::join_channel_handler,
        channels::inbound::axum_router::leave_channel_handler,
        channels::inbound::axum_router::get_channel_attachments_handler,
        channels::inbound::axum_router::get_channel_handler,
        channels::inbound::axum_router::get_channel_participants_handler,
        channels::inbound::axum_router::get_batch_channel_preview_handler,
        channels::inbound::axum_router::create_mention_handler,
        channels::inbound::axum_router::delete_mention_handler,
        channels::inbound::axum_router::get_attachment_references_handler,
        channels::inbound::axum_router::get_activity_handler,
        channels::inbound::axum_router::post_activity_handler,

        // harnesses
        harnesses::inbound::axum_router::create_pairing_handler,
        harnesses::inbound::axum_router::get_pairing_handler,
        harnesses::inbound::axum_router::approve_pairing_handler,
        harnesses::inbound::axum_router::claim_pairing_handler,
        harnesses::inbound::axum_router::list_harnesses_handler,
        harnesses::inbound::axum_router::delete_harness_handler,
        harnesses::inbound::axum_router::list_bound_agents_handler,
        harnesses::inbound::axum_router::get_self_harness_handler,
        harnesses::inbound::axum_router::delete_self_harness_handler,
        harnesses::inbound::axum_router::list_harness_sessions_handler,

        // bots
        bots::inbound::axum_router::create_agent_handler,
        bots::inbound::axum_router::list_agents_handler,
        bots::inbound::axum_router::update_agent_handler,
        bots::inbound::axum_router::get_self_bot_handler,
        bots::inbound::axum_router::get_bot_owner_profiles_handler,
        bots::inbound::axum_router::list_bot_channels_handler,
        bots::inbound::axum_router::remove_bot_channel_handler,
        bots::inbound::channel_webhook_router::create_channel_scoped_bot_handler,
        bots::inbound::channel_webhook_router::post_channel_webhook_handler,

        // calls
        call::inbound::axum_router::meetings::create,
        call::inbound::axum_router::meetings::prepare,
        call::inbound::axum_router::meetings::cancel_preparation,
        call::inbound::axum_router::meetings::update,
        call::inbound::axum_router::meetings::list,
        call::inbound::axum_router::meetings::list_active,
        call::inbound::axum_router::meetings::cancel,
        call::inbound::axum_router::meetings::share,
        call::inbound::axum_router::meetings::join,
        call::inbound::axum_router::meetings::invite,
        call::inbound::axum_router::meetings::invite_permissions,
        call::inbound::axum_router::meetings::invite_users,
        call::inbound::axum_router::meetings::lookup,
        call::inbound::axum_router::meetings::participants,
        call::inbound::axum_router::meetings::guest_participants,
        call::inbound::axum_router::meetings::guest_join,
        call::inbound::axum_router::meetings::leave,
        call::inbound::axum_router::get_or_create_call_handler,
        call::inbound::axum_router::check_active_call_handler,
        call::inbound::axum_router::get_active_calls_handler,
        call::inbound::axum_router::leave_or_end_call_handler,
        call::inbound::axum_router::get_call_record_handler,
        call::inbound::axum_router::edit_call_record_handler,
        call::inbound::axum_router::edit_call_transcript_handler,
        call::inbound::axum_router::delete_call_record_handler,
        call::inbound::axum_router::toggle_share_with_team_handler,
        call::inbound::axum_router::get_batch_call_record_preview_handler,
        call::inbound::axum_router::webhook_handler,
        webhook::inbound::axum_router::create_webhook,
        webhook::inbound::axum_router::delete_webhook,
        webhook::inbound::axum_router::get_webhook,
        webhook::inbound::axum_router::list_webhooks,
        webhook::inbound::axum_router::patch_webhook,
        webhook::inbound::axum_router::validate_webhook,
        webhook::inbound::stream_router::stream_events,
        call::inbound::axum_router::ring_status_handler,
        call::inbound::axum_router::transcript_handler,

        // pins
        pins::add_pin::add_pin_handler,
        pins::remove_pin::remove_pin_handler,
        pins::reorder_pins::reorder_pins_handler,
        pins::get_pins::get_pins_handler,

        // projects
        projects_hex::inbound::axum_router::get_projects::get_projects_handler,
        projects_hex::inbound::axum_router::get_projects::get_pending_projects_handler,
        projects_hex::inbound::axum_router::get_project::get_project_content_handler,
        projects_hex::inbound::axum_router::create_project::create_project_handler,
        projects_hex::inbound::axum_router::edit_project::edit_project_handler,
        projects_hex::inbound::axum_router::delete_project::delete_project_handler,
        projects_hex::inbound::axum_router::delete_project::permanently_delete_project_handler,
        projects_hex::inbound::axum_router::upload_folder::upload_folder_handler,
        projects_hex::inbound::axum_router::upload_folder::upload_extract_folder_handler,
        projects_hex::inbound::axum_router::project_permission::get_project_permissions_handler,
        projects_hex::inbound::axum_router::project_permission::get_project_access_level_handler,
        projects_hex::inbound::axum_router::get_batch_preview::get_batch_preview_handler,
        projects_hex::inbound::axum_router::get_project::get_project_handler,
        projects_hex::inbound::axum_router::revert_delete_project::revert_delete_project_handler,

        entity::get_entity_permission::handler,

        // favorites
        favorites::inbound::axum_router::list_favorites_handler,
        favorites::inbound::axum_router::add_favorite_handler,
        favorites::inbound::axum_router::remove_favorite_by_entity_handler,
        favorites::inbound::axum_router::reorder_favorites_handler,
        // channel labels
        channel_labels::inbound::axum_router::list_channel_labels_handler,
        channel_labels::inbound::axum_router::preview_smart_tag_handler,
        channel_labels::inbound::axum_router::create_channel_label_handler,
        channel_labels::inbound::axum_router::rename_channel_label_handler,
        channel_labels::inbound::axum_router::delete_channel_label_handler,
        channel_labels::inbound::axum_router::set_channel_label_handler,

        // user api keys
        user_api_key::inbound::axum_router::create_user_api_key_handler,
        user_api_key::inbound::axum_router::list_user_api_keys_handler,
        user_api_key::inbound::axum_router::delete_user_api_key_handler,

        // Slack archive imports
        slack_integration::inbound::axum_router::create::create,
        slack_integration::inbound::axum_router::uploads::register,
        slack_integration::inbound::axum_router::uploads::complete,
        slack_integration::inbound::axum_router::jobs::list,
        slack_integration::inbound::axum_router::jobs::progress,
        slack_integration::inbound::axum_router::jobs::finalize,
        slack_integration::inbound::axum_router::jobs::cancel,

        // reminders
        reminders::inbound::axum_router::get_email_followup_handler,
        reminders::inbound::axum_router::set_email_followup_handler,
        reminders::inbound::axum_router::email_collection::list_email_reminders_handler,
        // initiatives
        initiative::inbound::axum_router::list::list_initiatives_handler,
        initiative::inbound::axum_router::create::create_initiative_handler,
        initiative::inbound::axum_router::get::get_initiative_handler,
        initiative::inbound::axum_router::update::update_initiative_handler,
        initiative::inbound::axum_router::delete::delete_initiative_handler,
        // databases
        databases::inbound::axum_router::list_databases_handler,
        databases::inbound::starter_router::ensure_starter_handler,
        databases::inbound::axum_router::create_database_handler,
        databases::inbound::axum_router::get_database_handler,
        databases::inbound::axum_router::awareness_handler,
        databases::inbound::axum_router::ops::apply_ops_handler,
        databases::inbound::axum_router::views::view_positions_handler,
        databases::inbound::axum_router::history::row_history_handler,
        databases::inbound::axum_router::history::undo_change_handler,
        databases::inbound::axum_router::history::table_changes_handler,
        databases::inbound::axum_router::transfer::import_table_handler,
        databases::inbound::axum_router::sharing::get_permissions_handler,
        databases::inbound::axum_router::sharing::update_permissions_handler,
        databases::inbound::axum_router::saved_queries::save_query_handler,
        databases::inbound::axum_router::saved_queries::get_query_handler,
        databases::inbound::axum_router::casts::column_casts_handler,
        databases::inbound::axum_router::casts::column_conversion_handler,
        databases::inbound::axum_router::infer_column_type_handler,
        // collab surfaces
        collab_surface::inbound::axum_router::ensure_surface_handler,
        collab_surface::inbound::axum_router::get_surface_handler,
        collab_surface::inbound::axum_router::mint_token_handler,
        collab_surface::inbound::axum_router::delete_surface_handler,

        // foreign_entity
        foreign_entity::inbound::axum_router::get_foreign_entity_handler,
        foreign_entity::inbound::axum_router::get_foreign_entity_by_source_handler,

        // github_pull_requests
        github_pull_requests::inbound::axum_router::get_github_pull_request_facets_handler,
        github_pull_requests::inbound::axum_router::get_github_pull_request_handler,
        github_pull_requests::inbound::changes_router::get_github_pull_request_changes_handler,
        github_pull_requests::inbound::changes_router::get_github_pull_request_changes_patch_handler,

        // threads
        threads::edit_thread::edit_thread_handler,

        // /recents
        recents::recently_deleted::handler,
        saved_views::create_view_handler,
        saved_views::get_views_handler,
        saved_views::delete_view_handler,
        saved_views::patch_view_handler,
        saved_views::exclude_default_view_handler,

        // /github
        github::inbound::github_sync_router::install_sync_handler,

        // /internal/sync_service
        sync_service_hex::inbound::axum_router::bulk_wakeup_handler,

        // /crm
        crm::inbound::axum_router::set_email_sync::handler,
        crm::inbound::axum_router::set_company_hidden::handler,
        crm::inbound::axum_router::set_company_name::handler,
        crm::inbound::axum_router::set_contact_hidden::handler,
        crm::inbound::axum_router::set_contact_name::handler,
        crm::inbound::axum_router::list_company_contacts::handler,
        crm::inbound::axum_router::get_contact::handler,
        crm::inbound::axum_router::get_contact_by_email::handler,
        crm::inbound::axum_router::search_contacts::handler,
        crm::inbound::axum_router::get_company::handler,
        crm::inbound::axum_router::create_company::handler,
        crm::inbound::axum_router::create_contact::handler,
        crm::inbound::axum_router::team_settings::get_handler,
        crm::inbound::axum_router::team_settings::update_handler,
        crm::inbound::axum_router::stages::replace_handler,
        crm::inbound::axum_router::stages::reset_handler,
    ),
    components(
        schemas(
            DocumentStorageServiceApiVersion,
            GenericResponse,
            GenericErrorResponse,
            GenericSuccessResponse,
            SuccessResponse,
            UpdateOperation,
            FileType, // Generic
            CloudStorageItemType,
            Item,
            ItemWithUserAccessLevel, // Generics
            BasicDocument,
            DocumentMetadata,
            BomPart,
            DocumentResponseMetadata, // Document components
            GetDocumentResponse,
            GetDocumentResponseData, // Get single document
            CreateDocumentRequest,
            CreateDocumentResponse,
            CreateDocumentResponseData, // Create document
            documents_hex::domain::models::CreateMarkdownDocumentRequest,
            documents_hex::domain::models::CreateMarkdownDocumentResponse,
            documents_hex::domain::models::CreateTaskRequest,
            documents_hex::domain::models::CreateTaskResponse,
            documents_hex::domain::models::CreateSnippetRequest,
            documents_hex::domain::models::CreateSnippetResponse,
            documents_hex::domain::models::CreateSkillRequest,
            documents_hex::domain::models::CreateSkillResponse,
            documents_hex::domain::models::DocumentTeamShareResponse,
            documents_hex::domain::models::SetDocumentTeamShareRequest,
            documents_hex::domain::models::PropertyInput,
            models_properties::api::requests::SetPropertyValue,
            models_properties::shared::EntityReference,
            models_properties::shared::EntityType, // Quick create task
            CreateBulkDocumentResponseData,
            CreateBulkDocumentResponse, // Create document bulk
            GetDocumentListResult,
            GetDocumentSearchResponse, // Search document
            documents_hex::domain::models::CopyDocumentRequest,
            documents_hex::domain::models::CopyDocumentQueryParams,
            documents_hex::domain::models::CopyDocumentResponse, // Copy document
            documents_hex::domain::models::EditDocumentServiceArgs,
            EditDocumentResponse, // Edit document
            UserDocumentsResponse,
            GetDocumentsResponse, // Get user documents
            documents::get_starter_docs::StarterDocumentsResponse, // Get starter documents
            GetDocumentProcessingResult,
            GetDocumentProcessingResultResponse, // Document processing result
            GetDocumentKeyResponseData,
            GetDocumentKeyResponse,
            SaveDocumentRequest,
            SaveBomPart,
            SaveDocumentResponse,
            SaveDocumentResponseData,
            PresignedUrl, // Save document
            PreSaveDocumentRequest,
            PreSaveDocumentResponseData,
            PreSaveDocumentResponse, // pre save
            PinnedItem,
            PinRequest, // Generic pins
            AddPinRequest, // Add pin
            UserPinsResponse,
            GetPinsResponse, // Get pins
            ReorderPinRequest, // Reorder pins
            GetUserHistoryResponse, // Get user history
            CreateInstructionsDocumentResponse, // Instructions
            GetInstructionsDocumentResponse,
            UserViewsResponse,
            LocationResponseData, // location
            GetDocumentUserAccessLevelResponse,
            DocumentPermissionsTokenResponse,
            DocumentPermissionsToken,
            DocumentPermissionsTokenRequest,
            ExportDocumentResponse,
            SyncServiceVersionID,
            calendar_events::inbound::axum_router::CalendarOccurrenceItem,
            calendar_events::inbound::axum_router::CalendarOccurrenceResponse,
            calendar_events::inbound::axum_router::CalendarMentionPreviewRequest,
            calendar_events::inbound::axum_router::CalendarMentionPreviewRequestItem,
            calendar_events::inbound::axum_router::CalendarMentionPreviewResponse,
            calendar_events::inbound::axum_router::CalendarMentionPreviewItem,
            calendar_events::inbound::axum_router::CalendarMentionPreviewKind,
            calendar_events::inbound::axum_router::TeamOutOfOfficeItem,
            calendar_events::inbound::axum_router::TeamOutOfOfficeResponse,
            calendar_events::domain::models::CalendarMentionEvent,
            calendar_events::domain::models::CalendarSyncStatus,
            SoupItemWithProperties,
            SoupApiItem,
            SoupDocument<SoupPropertiesField>,
            SoupChat<SoupPropertiesField>,
            SoupProject<SoupPropertiesField>,
            SoupPropertiesField,
            SoupForeignEntity,
            ForeignEntity,
            GithubPullRequestFacets,
            GithubRepositoryFacet,
            GithubUserFacet,
            GithubLabelFacet,
            StoredGithubPullRequest,
            GithubPullRequestChangesResponse,
            GithubPullRequestChangesPatchResponse,
            ChangesetDto,
            ChangesetSourceDto,
            ChangedFileDto,
            FileChangeKindDto,
            GitRefDto,
            Favorite,
            FavoritesList,
            CreatedUserApiKey,
            CreateUserApiKeyRequest,
            UserApiKeyInfo,
            UserApiKeysList,
            AddFavoriteRequest,
            FavoriteEntityRef,
            ReorderFavoritesRequest,
            ChannelLabel,
            ChannelLabelsList,
            ChannelLabelRule,
            SmartTagChannelMatch,
            SmartTagPreview,
            CreateChannelLabelRequest,
            RenameChannelLabelRequest,
            SetChannelLabelRequest,
            // databases
            Database,
            DatabaseTable,
            DatabaseColumn,
            DatabaseColumnConfig,
            DatabaseTableVersion,
            ListedDatabase,
            DatabaseDetail,
            DatabaseTableDetail,
            DatabaseColumnDetail,
            CreateDatabaseRequest,
            DatabaseAwareness,
            DatabaseAwarenessRelay,
            DatabaseTableChanged,
            DatabaseApplyOpsRequest,
            DatabaseApplyOpsResponse,
            DatabaseOpRefusalResponse,
            DatabaseRowHistoryResponse,
            DatabaseRowHistoryEntry,
            DatabaseRowChangeKind,
            DatabaseUndoChangeResponse,
            DatabaseUndoOutcome,
            DatabaseUndoRefusal,
            DatabaseSkippedCell,
            DatabaseCommittedChange,
            DatabaseTableChanges,
            DatabaseTouchedRow,
            DatabaseTouchedColumn,
            DatabaseColumnChangeKind,
            DatabaseOp,
            DatabaseTableChange,
            DatabaseColumnChange,
            DatabaseRowsChange,
            DatabaseViewChange,
            DatabaseCellWrite,
            DatabaseCellValue,
            DatabaseRowChanges,
            DatabaseRowChange,
            DatabaseOptionRef,
            DatabaseEntityRef,
            DatabaseEntityKind,
            DatabaseColumnKind,
            DatabaseNewColumn,
            DatabaseNewOption,
            DatabaseOpResult,
            DatabaseTableResult,
            DatabaseColumnResult,
            DatabaseRowsResult,
            DatabaseViewResult,
            DatabaseTakenId,
            DatabaseVersionedTable,
            DatabaseView,
            DatabaseNewView,
            DatabaseViewQuery,
            DatabaseSortKey,
            DatabaseSortDirection,
            DatabaseFilterGroup,
            DatabaseFilterConjunction,
            DatabaseFilterNode,
            DatabaseFilterCondition,
            DatabaseFilterTest,
            DatabasePresenceOperator,
            DatabaseTextOperator,
            DatabaseNumberOperator,
            DatabaseDateOperator,
            DatabaseSetOperator,
            DatabaseViewLayout,
            DatabaseRequestedLayout,
            DatabaseViewColumn,
            DatabaseBoardLane,
            DatabaseLaneKey,
            DatabaseCardPosition,
            DatabaseViewPosition,
            DatabaseViewPositionsResponse,
            DatabaseQueryDefinition,
            DatabaseSavedQuery,
            DatabaseSaveQueryRequest,
            InitiativeId,
            InitiativeSummary,
            InitiativeDetail,
            InitiativeList,
            CreateInitiativeRequest,
            InitialPropertyValue,
            UpdateInitiativeRequest,
            CollabSurfaceResponse,
            CollabSurfaceTokenResponse,
            EnsureCollabSurfaceRequest,
            SurfaceState,
            SoupApiSort,
            SoupPage,
            SoupEnrichedEmailThreadPreview<SoupPropertiesField>,
            SoupEmailThreadPreview,
            SoupAttachment,
            SoupContact,
            SoupLabel,
            SoupLabelListVisibility,
            SoupMessageListVisibility,
            SoupLabelType,
            PostSoupRequest,
            PostSoupAstRequest,
            PostGroupedSoupAstInitialRequest,
            PostGroupedSoupAstGroupPageRequest,
            PostGroupedSoupAstRequest,
            ApiGroupByField,
            ApiGroupMeta,
            GroupedSoupInitialPage,
            GroupedSoupGroupPage,
            GroupedSoupPage,

            // Channel list (comms hex)
            channels::inbound::list_router::ApiChannelListPage,
            channels::inbound::list_router::ApiChannelWithLatest,
            channels::inbound::list_router::ApiChannelListMessage,
            channels::inbound::list_router::ApiChannelListParticipant,
            channels::inbound::list_router::ApiChannelListType,
            channels::inbound::list_router::ApiParticipantListRole,

            // Messages (channels and documents)
            messages::domain::models::MessageParent,
            messages::domain::models::DocumentId,
            messages::domain::models::Message,
            messages::domain::models::MessageThread,
            messages::domain::models::MessageListItem,
            messages::domain::models::MessageThreadPreview,
            messages::domain::models::ThreadState,
            messages::domain::models::ThreadAnchor,
            messages::domain::models::NewThreadAnchor,
            messages::domain::models::ThreadPatch,
            messages::domain::models::PostMessage,
            messages::domain::models::BotSenderProfile,
            messages::domain::models::ImportedAuthor,
            messages::domain::models::CountedReaction,
            messages::domain::models::MessageAttachment,
            messages::domain::models::NewAttachment,
            messages::domain::ports::MessageCursor,
            messages::domain::ports::MessageDirection,
            messages::domain::ports::MessageTimelineQuery,
            messages::domain::ports::MessagePage,
            messages::domain::ports::MessagePatch,
            messages::domain::ports::AttachmentChange,
            messages::domain::ports::MessageEvent,
            messages::domain::ports::MessageChange,
            messages::inbound::axum_router::ReactionInput,
            messages::inbound::axum_router::TypingInput,

            // Channels
            ApiChannelAttachmentsPage,
            ApiChannelAttachment,
            ApiChannelParticipant,
            ApiChannelDetail,
            ApiParticipantRole,
            GetAttachmentReferencesResponse,
            ApiAttachmentEntityReference,
            ApiAttachmentChannelReference,
            ApiAttachmentGenericReference,
            channels::domain::models::ChannelType,
            channels::domain::models::GetOrCreateAction,
            messages::domain::models::SimpleMention,
            channels::domain::models::CreateChannelRequest,
            channels::domain::models::CreateChannelResponse,
            channels::domain::models::GetOrCreateDmRequest,
            channels::domain::models::GetOrCreatePrivateRequest,
            channels::domain::models::GetOrCreateChannelResponse,
            channels::domain::models::PatchChannelRequest,
            channels::domain::models::AddParticipantsRequest,
            channels::domain::models::RemoveParticipantsRequest,
            channels::domain::models::GetBatchChannelPreviewRequest,
            channels::domain::models::GetBatchChannelPreviewResponse,
            channels::domain::models::ChannelPreview,
            channels::domain::models::ChannelPreviewData,
            channels::domain::models::WithChannelId,
            CreateEntityMentionRequest,
            CreateEntityMentionResponse,
            DeleteEntityMentionResponse,
            channels::domain::models::ActivityType,
            ApiActivity,
            PostActivityRequest,

            // Harnesses
            harnesses::domain::models::Harness,
            harnesses::domain::models::HarnessOwner,
            harnesses::domain::models::HarnessAgent,
            harnesses::domain::models::HarnessSession,
            harnesses::domain::models::RequestedHarnessScope,
            harnesses::domain::models::CreatePairingRequest,
            harnesses::domain::models::CreatedPairing,
            harnesses::domain::models::PairingDetails,
            harnesses::domain::models::ApprovePairingRequest,
            harnesses::domain::models::ClaimPairingRequest,
            harnesses::domain::models::ClaimedPairing,
            harnesses::inbound::axum_router::PendingClaimResponse,

            // Bots
            bots::domain::models::Agent,
            bots::domain::models::AgentChannelScope,
            bots::domain::models::AgentMcpServers,
            bots::domain::models::AgentMcpServer,
            bots::domain::models::CreateAgentRequest,
            bots::domain::models::UpdateAgentRequest,
            bots::domain::models::Bot,
            bots::domain::models::BotKind,
            bots::domain::models::BotOwner,
            bots::domain::models::BotOwnerProfile,
            bots::domain::models::BotToken,
            bots::domain::models::BotChannel,
            bots::domain::models::BotChannelType,
            bots::domain::models::ChannelWebhookRequest,
            bots::domain::models::ChannelWebhookResponse,
            bots::domain::models::CreateBotRequest,
            bots::domain::models::PatchBotRequest,
            bots::domain::models::CreateChannelScopedBotRequest,
            bots::domain::models::CreateChannelScopedBotResponse,

            // Calls
            call::domain::models::CallTokenResponse,
            call::domain::models::CallActiveResponse,
            call::domain::models::ActiveCallSummary,
            call::domain::models::ActiveCallsResponse,
            call::domain::models::LeaveCallResponse,
            call::domain::models::TranscriptSegmentRequest,
            call::domain::models::CallRecord,
            call::domain::models::CallRecordParticipant,
            call::domain::models::CallRecordTranscriptSegment,
            call::domain::models::EditCallRecordRequest,
            call::domain::models::EditCallTranscriptRequest,
            call::domain::models::CustomSpeakerAssignment,
            call::domain::models::CallRecordPreview,
            call::domain::models::CallRecordPreviewData,
            call::domain::models::WithCallId,
            call::domain::models::GetBatchCallRecordPreviewRequest,
            call::domain::models::GetBatchCallRecordPreviewResponse,
            call::domain::models::RingStatus,
            call::domain::models::RingStatusResponse,
            SoupCallRecord<SoupPropertiesField>,
            SoupCallRecordParticipant,

            // Webhooks
            webhook::domain::events::WebhookEvent,
            webhook::domain::models::CreateWebhookRequest,
            webhook::domain::models::CreateWebhookResponse,
            webhook::domain::models::ListWebhooksResponse,
            webhook::domain::models::PatchWebhookRequest,
            webhook::domain::models::ValidateWebhookResponse,
            webhook::domain::models::Webhook,
            webhook::domain::models::WebhookFilter,
            webhook::domain::models::WebhookStatus,
            webhook::domain::models::WebhookValidationTestEvent,
            dictation::inbound::axum_router::TranscribeResponse,

            DocumentSubType,


            // Permissions V2
            models_permissions::share_permission::LinkShare,
            models_permissions::share_permission::access_level::AccessLevel,
            models_permissions::share_permission::SharePermissionV2,
            models_permissions::share_permission::UpdateSharePermissionRequestV2, // Share permission
            models_permissions::share_permission::channel_share_permission::ChannelSharePermission,
            models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission, // Channel share permissions
            entity::get_entity_permission::EntityPermissionResponse,
            entity_access::domain::models::EntityPermission,
            entity_access::domain::models::ParticipantRole,

            // Chat
            Chat,

            // Projects
            Project,
            GetProjectsResponse,
            GetProjectContentResponse,
            CreateProjectRequest,
            CreateProjectResponse,
            PatchProjectRequestV2,
            GetProjectResponse,
            GetProjectResponseData,
            ProjectDeleteResponseData,
            ProjectDeleteResponse,

            // Preview
            GetDocumentPermissionsResponseDataV2,
            GetBatchPreviewRequest,
            GetBatchPreviewResponse,
            GetBatchProjectPreviewRequest,
            GetBatchProjectPreviewResponse,
            UserDocumentViewLocation,
            UpsertUserDocumentViewLocationRequest,
            UserDocumentViewLocationResponse,

            // Annotations
            AnnotationIncrementalUpdate,

            // Recents
            RecentlyDeletedResponseData,
            RecentlyDeletedResponse,

            View,
            ExcludedDefaultView,
            ViewPatch,

            CreateViewRequest,
            ExcludeDefaultViewRequest,
            BranchNameResponse,
            ShortIdResponse,
            documents_hex::domain::models::GithubPullRequest,
            documents_hex::domain::models::GithubPullRequestCheckRun,
            documents_hex::domain::models::GithubPullRequestComment,
            documents_hex::domain::models::GithubPullRequestsResponse,

            // Sync service
            sync_service_hex::domain::models::BulkWakeupRequest,
            sync_service_hex::domain::models::BulkWakeupResponse,

            // CRM
            crm::inbound::axum_router::set_email_sync::SetEmailSyncRequest,
            crm::inbound::axum_router::set_company_hidden::SetCompanyHiddenRequest,
            crm::inbound::axum_router::set_company_name::SetCompanyNameRequest,
            crm::inbound::axum_router::set_contact_hidden::SetContactHiddenRequest,
            crm::inbound::axum_router::set_contact_name::SetContactNameRequest,
            crm::inbound::axum_router::list_company_contacts::CrmContactResponse,
            crm::inbound::axum_router::get_company::CrmCompanyResponse,
            crm::inbound::axum_router::get_company::CrmDomainResponse,
            crm::inbound::axum_router::create_company::CreateCrmCompanyRequest,
            crm::inbound::axum_router::create_contact::CreateCrmContactRequest,
            crm::inbound::axum_router::stages::ReplaceCrmStagesRequest,
            crm::inbound::axum_router::stages::CrmStageInput,
            crm::inbound::axum_router::stages::CrmStagesResponse,
            crm::inbound::axum_router::stages::CrmStageResponse,
            crm::inbound::axum_router::team_settings::CrmTeamSettingsResponse,
            crm::inbound::axum_router::team_settings::UpdateCrmTeamSettingsRequest,
            crm::domain::model::CrmPermissionRole,
        ),
    ),
    tags(
            (name = "macro cloud storage service", description = "Macro Cloud Storage Service")
    )
)]
pub struct ApiDoc;

struct FormsApiAddon;

impl utoipa::Modify for FormsApiAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi.merge(forms::inbound::axum_router::FormsApi::openapi());
    }
}

#[cfg(test)]
mod test;
