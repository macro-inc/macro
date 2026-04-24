use crate::{
    Result, delegate_methods,
    search::builder::{SearchQueryBuilder, SearchQueryConfig},
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{BoolQueryBuilder, QueryType};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct CallRecordIndex {
    pub entity_id: uuid::Uuid,
    pub channel_id: uuid::Uuid,
    pub transcript_id: uuid::Uuid,
    #[serde(default)]
    pub participant_ids: Vec<String>,
    #[serde(default)]
    pub channel_name: Option<String>,
    pub speaker_id: String,
    pub sequence_num: i32,
    pub started_at_seconds: i64,
    #[serde(default)]
    pub ended_at_seconds: Option<i64>,
}

pub(crate) struct CallRecordSearchConfig;

impl SearchQueryConfig for CallRecordSearchConfig {
    const TITLE_KEY: &'static str = "channel_name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::CallRecords;
}

pub(crate) struct CallRecordQueryBuilder {
    inner: SearchQueryBuilder<CallRecordSearchConfig>,
    channel_ids: Vec<String>,
    speaker_ids: Vec<String>,
}

impl CallRecordQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            channel_ids: Vec::new(),
            speaker_ids: Vec::new(),
        }
    }

    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn channel_ids(mut self, channel_ids: Vec<String>) -> Self {
        self.channel_ids = channel_ids;
        self
    }

    pub fn speaker_ids(mut self, speaker_ids: Vec<String>) -> Self {
        self.speaker_ids = speaker_ids;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        // Access comes from `ids_only` + accessible call_ids; these just narrow.
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        if !self.channel_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("channel_id", self.channel_ids.clone()));
        }

        if !self.speaker_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("speaker_id", self.speaker_ids.clone()));
        }

        Ok(content_bool_query)
    }
}

#[derive(Debug, Default)]
pub struct CallRecordSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub call_ids: Vec<String>,
    pub channel_ids: Vec<String>,
    pub speaker_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    pub ids_only: bool,
}

impl From<CallRecordSearchArgs> for CallRecordQueryBuilder {
    fn from(args: CallRecordSearchArgs) -> Self {
        CallRecordQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.call_ids)
            .channel_ids(args.channel_ids)
            .speaker_ids(args.speaker_ids)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
    }
}
