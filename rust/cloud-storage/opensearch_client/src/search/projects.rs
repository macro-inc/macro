use crate::{
    Result, delegate_methods,
    search::builder::{SearchQueryBuilder, SearchQueryConfig},
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
}

impl ProjectQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
        }
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
    pub updated_at_seconds: Option<i64>,
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
    }
}
