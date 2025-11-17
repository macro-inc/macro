use crate::Result;
use crate::SearchOn;
use crate::error::OpensearchClientError;
use crate::search::model::MacroEm;
use crate::search::query::Keys;
use crate::search::query::QueryKey;
use crate::search::query::generate_name_content_query;
use crate::search::query::generate_terms_must_query;
use opensearch_query_builder::*;

/// A macro for generating delegation methods that forward calls to an inner field
/// and return Self to maintain builder pattern chainability.
///
/// # Usage
/// ```rust
/// use opensearch_client::delegate_methods;
/// # struct Inner;
/// # impl Inner {
/// #     fn method1(self, _param: &str) -> Self { self }
/// #     fn method2(self, _param1: i32, _param2: bool) -> Self { self }
/// # }
///
/// struct Outer {
///     inner: Inner,
/// }
///
/// impl Outer {
///     delegate_methods! {
///         fn method1(param: &str) -> Self;
///         fn method2(param1: i32, param2: bool) -> Self;
///     }
/// }
/// ```
#[macro_export]
macro_rules! delegate_methods {
    ($(fn $method:ident($($param:ident: $param_type:ty),*) -> Self;)*) => {
        $(
            pub fn $method(mut self, $($param: $param_type),*) -> Self {
                self.inner = self.inner.$method($($param),*);
                self
            }
        )*
    };
}

pub trait SearchQueryConfig {
    /// Key for item id
    const ID_KEY: &'static str;
    /// Index name
    #[allow(dead_code)]
    const INDEX: &'static str;
    /// Key for user id
    const USER_ID_KEY: &'static str;
    /// Key for title
    const TITLE_KEY: &'static str;
    /// Content field
    const CONTENT_KEY: &'static str = "content";

    /// Returns the default sort types that are used on the search query.
    /// Override this method if you need custom sort logic
    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
        ]
    }

    /// Override this method if you need custom highlight logic
    fn default_highlight() -> Highlight {
        Highlight::new().require_field_match(true).field(
            "content",
            HighlightField::new()
                .highlight_type("plain")
                .pre_tags(vec![MacroEm::Open.to_string()])
                .post_tags(vec![MacroEm::Close.to_string()])
                .number_of_fragments(500),
        )
    }
}

#[derive(Default)]
pub struct SearchQueryBuilder<T: SearchQueryConfig> {
    /// The terms to search for
    pub terms: Vec<String>,
    /// The match type to use when searching
    /// Defaults to "exact"
    pub match_type: String,
    /// The page number to start at
    /// Defaults to 0
    pub page: u32,
    /// The page size to use
    /// Defaults to 10
    pub page_size: u32,
    /// The user id to search for
    pub user_id: String,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    pub search_on: SearchOn,
    /// Whether to collapse the results to be a single result per ID_KEY
    /// Defaults to false.
    pub collapse: bool,
    /// If true, only search over the set of ids instead of ids + user_id.
    /// Defaults to false.
    pub ids_only: bool,
    /// The ids to search for defaults to an empty vector
    pub ids: Vec<String>,
    /// If true, disable the recency filter.
    /// This only applies to the NameContent search_on
    pub disable_recency: bool,

    _phantom: std::marker::PhantomData<T>,
}

impl<T: SearchQueryConfig> SearchQueryBuilder<T> {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            terms,
            match_type: "exact".to_string(), // default
            page: 0,
            page_size: 10,
            user_id: String::new(),
            search_on: SearchOn::Content,
            collapse: false,
            ids_only: false,
            ids: Vec::new(),
            disable_recency: false,
            _phantom: std::marker::PhantomData,
        }
    }

    pub fn match_type(mut self, match_type: &str) -> Self {
        self.match_type = match_type.to_string();
        self
    }

    pub fn page(mut self, page: u32) -> Self {
        self.page = page;
        self
    }

    pub fn page_size(mut self, page_size: u32) -> Self {
        self.page_size = page_size;
        self
    }

    pub fn user_id(mut self, user_id: &str) -> Self {
        self.user_id = user_id.to_string();
        self
    }

    pub fn search_on(mut self, search_on: SearchOn) -> Self {
        self.search_on = search_on;
        self
    }

    pub fn collapse(mut self, collapse: bool) -> Self {
        self.collapse = collapse;
        self
    }

    pub fn ids_only(mut self, ids_only: bool) -> Self {
        self.ids_only = ids_only;
        self
    }

    pub fn ids(mut self, ids: Vec<String>) -> Self {
        self.ids = ids;
        self
    }

    pub fn disable_recency(mut self, disable_recency: bool) -> Self {
        self.disable_recency = disable_recency;
        self
    }

    /// Builds the core bool query which contains all core "should" and "must" clauses
    pub fn build_bool_query(&self) -> Result<BoolQueryBuilder> {
        let mut bool_query = BoolQueryBuilder::new();

        // Currently, the minimum should match is always one.
        // This should of the bool query contains the ids and potentially the user_id
        bool_query.minimum_should_match(1);

        let term_must_array: Vec<QueryType> = self.build_must_term_query()?;

        tracing::trace!("term_must_array: {:?}", term_must_array);

        // For each item in term must array, add to bool must query
        for must in term_must_array {
            bool_query.must(must);
        }

        // Add any ids to the should array if provided
        if !self.ids.is_empty() {
            bool_query.should(QueryType::terms(T::ID_KEY, self.ids.to_vec()));
        }

        // If we are not searching over the ids, we need to add the user_id to the should array
        if !self.ids_only {
            bool_query.should(QueryType::term(T::USER_ID_KEY, self.user_id.clone()));
        }

        Ok(bool_query)
    }

    /// Builds the search request with the provided main bool query
    /// This will automatically wrap the bool query in a function score if
    /// SearchOn::NameContent is used
    pub fn build_search_request(&self, query_object: BoolQuery) -> Result<SearchRequest> {
        let mut search_request = SearchRequestBuilder::new();

        // Collapse on the ID_KEY if collapse is true
        // or if we are searchign on Name or NameContent
        if self.collapse
            || self.search_on == SearchOn::Name
            || self.search_on == SearchOn::NameContent
        {
            search_request.collapse(Collapse::new(T::ID_KEY));
        }

        let highlight = match self.search_on {
            SearchOn::Content => T::default_highlight(),
            SearchOn::Name => Highlight::new().require_field_match(true).field(
                T::TITLE_KEY,
                HighlightField::new()
                    .highlight_type("plain")
                    .pre_tags(vec![MacroEm::Open.to_string()])
                    .post_tags(vec![MacroEm::Close.to_string()])
                    .number_of_fragments(1),
            ),
            SearchOn::NameContent => Highlight::new()
                .require_field_match(false)
                .field(
                    T::TITLE_KEY,
                    HighlightField::new()
                        .highlight_type("plain")
                        .pre_tags(vec![MacroEm::Open.to_string()])
                        .post_tags(vec![MacroEm::Close.to_string()])
                        .number_of_fragments(1),
                )
                .field(
                    T::CONTENT_KEY,
                    HighlightField::new()
                        .highlight_type("plain")
                        .pre_tags(vec![MacroEm::Open.to_string()])
                        .post_tags(vec![MacroEm::Close.to_string()])
                        .number_of_fragments(1),
                ),
        };

        search_request.highlight(highlight);
        search_request.set_sorts(T::default_sort_types());

        search_request.from(self.page * self.page_size);
        search_request.size(self.page_size);

        let built_query: QueryType = match self.search_on {
            SearchOn::Name | SearchOn::Content => query_object.into(),
            SearchOn::NameContent => {
                if self.disable_recency {
                    query_object.into()
                } else {
                    let mut function_score_query = FunctionScoreQueryBuilder::new();

                    function_score_query.query(query_object.into());

                    function_score_query.function(ScoreFunction {
                        function: ScoreFunctionType::Gauss(DecayFunction {
                            field: "updated_at_seconds".to_string(),
                            origin: Some("now".into()),
                            scale: "21d".to_string(),
                            offset: Some("3d".to_string()),
                            decay: Some(0.5),
                        }),
                        filter: None,
                        weight: Some(1.3),
                    });

                    function_score_query.boost_mode(BoostMode::Multiply);
                    function_score_query.score_mode(ScoreMode::Multiply);

                    function_score_query.build().into()
                }
            }
        };

        // We need to add aggregration and tracking to the query if we are searching on NameContent
        if self.search_on == SearchOn::NameContent && !self.disable_recency {
            search_request.track_total_hits(true);
            search_request.add_agg(
                "total_uniques".to_string(),
                AggregationType::Cardinality(CardinalityAggregation::new(T::ID_KEY)),
            );
        }

        search_request.query(built_query);

        Ok(search_request.build())
    }

    /// Generates a vec of term queries to be put inside of the bool must query
    pub fn build_must_term_query(&self) -> Result<Vec<QueryType>> {
        let keys = Keys {
            title_key: T::TITLE_KEY,
            content_key: T::CONTENT_KEY,
        };

        if self.terms.is_empty() {
            return Err(OpensearchClientError::NoTermsProvided);
        }

        let query_key = QueryKey::from_match_type(&self.match_type)?;

        let mut must_array = Vec::new();

        match self.search_on {
            SearchOn::Name => {
                // map all terms over title key
                must_array.push(generate_terms_must_query(
                    query_key,
                    &[keys.title_key],
                    &self.terms,
                ));
            }
            SearchOn::Content => {
                // map all terms over content key
                must_array.push(generate_terms_must_query(
                    query_key,
                    &[keys.content_key],
                    &self.terms,
                ));
            }
            SearchOn::NameContent => {
                must_array.push(generate_name_content_query(&keys, &self.terms));
            }
        };

        Ok(must_array)
    }
}

#[cfg(test)]
mod test;
