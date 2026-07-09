use super::context::SearchToolContext;
use super::types::{
    PAGE_SIZE, SearchMatchType, SearchToolResponse, annotate_result_tags, resolve_tag_filters,
    tag_filter_mode,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use email::domain::ports::EmailService;
use item_filters::{EmailFilters, EntityFilters};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::tag_sets::{TagFilter, TagMatch};
use models_search::unified::{
    UnifiedSearchIndex, UnifiedSearchRequest, entity_filters_from_include,
};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Search items by their content: document body text; email subject/body/sender/recipient/cc/bcc and the display names on those addresses; chat messages; call transcripts. This is keyword search, not semantic search: queries only match literal words/tokens, prefixes, or exact quoted terms that appear in the indexed content. Use this for targeted keyword/content lookup, not for activity-summary questions like \"what happened today\", \"what's going on\", \"catch me up\", or \"what happened in standup today\"; those should start with ListEntities using time/type/channel filters. Whitespace-separated terms are ANDed. For documents and emails, every term must match somewhere in the document — different terms can appear in different chunks/pages or different fields. For documents and emails specifically, each single-word term is matched as a prefix (so `scri` matches `script`); for emails the prefix expansion also runs against the local-part of address fields. For chats, channels, and call transcripts the whole query is matched as a single adjacent phrase prefix — so pass 1-3 targeted keywords drawn from words that would literally appear in the content, not the user's natural-language description; long phrases will not match. Matching defaults to prefix; set matchType to 'exact' to match whole tokens/phrases with no prefix expansion (e.g. an exact word, identifier, or full email address). Wrap a multi-word phrase in double quotes to keep it together as one adjacent phrase. If the user's request combines a person with a topic, run separate searches rather than one combined query. Leave entityTypes empty by default; only filter when the user explicitly scopes to a type. Results for documents, emails, AI chats, and projects include the tags visible to the user as {label, scope} pairs; to restrict a search to tagged items, pass the tag labels in the tags argument (ListTags shows which tags exist).",
    title = "ContentSearch"
)]
pub struct ContentSearch {
    #[schemars(
        description = "The text to search. Pass 1-3 keywords drawn from words that would literally appear in the content, not the user's natural-language description. Whitespace-separated terms are ANDed. For documents, every term must appear somewhere in the document (different chunks/pages are fine). For emails each term is matched across subject/body/sender/recipient. For chats/channels/calls the whole query is matched as a single adjacent phrase prefix, so long phrases will not match. Wrap a multi-word phrase in double quotes to match it as one phrase. Use matchType 'exact' for whole-token (or full email address) matching instead of prefix."
    )]
    pub query: String,

    #[schemars(
        description = "Matching mode. 'partial' (the default) matches each single word as a prefix, so `scri` matches `script`. 'exact' matches each term as a complete token or phrase with no prefix expansion — use it when the user wants an exact word, identifier, code, email address, or quoted phrase rather than a prefix."
    )]
    #[serde(default)]
    pub match_type: SearchMatchType,

    #[schemars(
        description = "Which types of items to search. Leave empty (the default) to search all types — this is almost always what you want. Only set this when the user's request clearly targets one or more specific types. Examples: ['documents'], ['emails', 'documents'], ['channels'], ['call_records']."
    )]
    #[serde(default)]
    pub entity_types: Vec<UnifiedSearchIndex>,

    #[schemars(
        description = "Restrict email results to a single connected inbox, given as that inbox's email address (from ListInboxes). Omit to search every inbox the user can access. Only set this when the user scopes the request to a specific mailbox. Only affects email results."
    )]
    #[serde(default)]
    pub inbox: Option<String>,

    #[schemars(description = "\
Restrict results to items carrying the given tags — any of them by default, every one of \
them with tagsMatch=\"all\". Each entry names a tag by its label, matched case-insensitively \
against the user's own tags; only set scope (\"personal\" or \"team\") when the user \
distinguishes between their personal and team tags. An unknown label fails with the list of \
available tags — call ListTags first when unsure what tags exist. Only taggable items \
(documents, emails, AI chats, projects) can match, so channels and call records are dropped \
while a tag filter is active.")]
    #[serde(default)]
    pub tags: Option<Vec<TagFilter>>,

    #[schemars(description = "\
How multiple entries in tags combine: \"any\" (the default) matches items carrying at least \
one of the tags, \"all\" only items carrying every one of them. Ignored unless tags is set.")]
    #[serde(default)]
    pub tags_match: TagMatch,
}

#[async_trait]
impl AsyncTool<SearchToolContext> for ContentSearch {
    type Output = SearchToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        search_context: ServiceContext<SearchToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Content search params");

        if self.query.trim().is_empty() {
            return Err(ToolCallError {
                description: "query must not be empty".to_string(),
                internal_error: anyhow::anyhow!("query must not be empty"),
            });
        }

        let mut email_filters = EmailFilters {
            importance: Some(true),
            ..Default::default()
        };
        if let Some(inbox) = self
            .inbox
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let inboxes = search_context
                .email_service
                .get_inboxes_for_macro_id(MacroUserIdStr((*request_context.user_id).clone()))
                .await
                .map_err(|e| ToolCallError {
                    description: format!("Failed to resolve inboxes: {e}"),
                    internal_error: e.into(),
                })?;
            let caller_macro_id = request_context.user_id.to_string();
            let link = email::inbound::toolset::resolve_inbox_selector(
                &inboxes,
                &caller_macro_id,
                Some(inbox),
            )?;
            email_filters.link_ids = vec![link.id.to_string()];
        }
        let mut tag_sets = None;
        let mut tag_option_ids = Vec::new();
        if let Some(filters) = self.tags.as_deref().filter(|t| !t.is_empty()) {
            let (sets, option_ids) = resolve_tag_filters(
                &search_context,
                (*request_context.user_id).as_ref(),
                filters,
            )
            .await?;
            tag_sets = Some(sets);
            tag_option_ids = option_ids;
        }

        let base_filters = EntityFilters {
            email_filters,
            tag_option_ids,
            tag_filter_mode: tag_filter_mode(self.tags_match),
            ..Default::default()
        };
        let search_request = UnifiedSearchRequest {
            query: self.query.to_owned(),
            match_type: self.match_type.into(),
            filters: entity_filters_from_include(self.entity_types.clone(), base_filters),
            search_on: models_search::SearchOn::Content,
            include_crm: false,
            collapse: None,
        };

        let response = search_context
            .search_client
            .search_unified(
                (*request_context.user_id).as_ref(),
                search_request,
                None,
                PAGE_SIZE,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to perform content search: {}", e),
                internal_error: e,
            })?;

        // Drop the chat the agent is currently running inside so it never
        // surfaces itself in its own search results.
        let mut results = response.results;
        if let Some(self_chat_id) = search_context.self_chat_id {
            results.retain(|item| item.entity_id() != self_chat_id);
        }

        let results = annotate_result_tags(
            &search_context,
            (*request_context.user_id).as_ref(),
            results,
            tag_sets,
        )
        .await?;

        Ok(SearchToolResponse { results })
    }
}
