use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        properties::build_tag_filter,
    },
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{BoolQueryBuilder, QueryType};

#[derive(Clone)]
pub(crate) struct ProjectSearchConfig;

impl SearchQueryConfig for ProjectSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("owner_id");
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Projects;
}

/// Query builder for the flat projects index. Projects carry no content, so
/// every mode matches terms against the parent `name` only. Access control
/// mirrors documents: `owner_id == caller` and/or `entity_id ∈ ids` resolved
/// from Postgres at query time.
pub(crate) struct ProjectQueryBuilder {
    inner: SearchQueryBuilder<ProjectSearchConfig>,
    tag_option_ids: Vec<String>,
    match_all_tags: bool,
}

impl ProjectQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            tag_option_ids: Vec::new(),
            match_all_tags: false,
        }
    }

    pub fn tag_option_ids(mut self, tag_option_ids: Vec<String>) -> Self {
        self.tag_option_ids = tag_option_ids;
        self
    }

    pub fn match_all_tags(mut self, match_all_tags: bool) -> Self {
        self.match_all_tags = match_all_tags;
        self
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut bool_query = BoolQueryBuilder::new();

        // Only search on the projects alias.
        bool_query.filter(QueryType::term(
            "_index",
            ProjectSearchConfig::ENTITY_INDEX.index_name().to_string(),
        ));

        // Access control: owner and/or accessible entity ids.
        bool_query.filter(
            self.inner
                .build_filter_query(ProjectSearchConfig::USER_ID_KEY)?,
        );

        // Tag filter: nested clause(s) matching the option ids in
        // `properties.values`, with no definition_id constraint.
        if let Some(nested) = build_tag_filter(&self.tag_option_ids, self.match_all_tags) {
            bool_query.filter(nested);
        }

        // Name match: every term must match the project name.
        bool_query.must(self.inner.build_title_term_query()?);

        Ok(bool_query)
    }
}

/// The `_source` fields of a project doc as returned by search.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ProjectIndex {
    pub entity_id: uuid::Uuid,
    pub name: String,
    pub owner_id: String,
    #[serde(default)]
    pub parent_project_id: Option<String>,
    #[serde(default)]
    pub updated_at_millis: Option<i64>,
}

#[derive(Debug)]
pub struct ProjectSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub project_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    pub ids_only: bool,
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
}

impl From<ProjectSearchArgs> for ProjectQueryBuilder {
    fn from(args: ProjectSearchArgs) -> Self {
        ProjectQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.project_ids)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .tag_option_ids(args.tag_option_ids)
            .match_all_tags(args.match_all_tags)
    }
}
