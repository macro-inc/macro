use std::borrow::Cow;

use crate::Result;
use crate::SearchOn;
use crate::error::OpensearchClientError;
use crate::search::model::MacroEm;
use crate::search::query::Keys;
use crate::search::query::QueryKey;
use crate::search::query::generate_terms_must_query;
use models_opensearch::SearchEntityType;
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

/// Creates a highlight field
pub(crate) fn create_highlight_field<'a>(
    highlight_type: &'a str,
    number_of_fragments: u32,
) -> HighlightField<'a> {
    HighlightField::new()
        .highlight_type(highlight_type)
        .pre_tags(vec![MacroEm::Open.to_string()])
        .post_tags(vec![MacroEm::Close.to_string()])
        .number_of_fragments(number_of_fragments)
}

/// Creates sort vec to sort by the updated_at with a fallback to score sort
pub(crate) fn updated_at_sort<'a>() -> Vec<SortType<'a>> {
    vec![
        SortType::ScriptSort(ScriptSort::new(
            Script::new(
                r#"if (doc.containsKey('sent_at_seconds') && doc['sent_at_seconds'].size() > 0) {
                    return doc['sent_at_seconds'].value.toInstant().toEpochMilli();
                } else if (doc.containsKey('updated_at_seconds') && doc['updated_at_seconds'].size() > 0) {
                    return doc['updated_at_seconds'].value.toInstant().toEpochMilli();
                } else {
                    return 0L;  // Or Long.MAX_VALUE to push to end
                }"#,
            ),
            ScriptSortType::Number,
            SortOrder::Desc,
        )),
        SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
    ]
}
pub trait SearchQueryConfig {
    /// Key for item id
    const ID_KEY: &'static str = "entity_id";
    /// Key for user id
    const USER_ID_KEY: &'static str;
    /// Key for title
    const TITLE_KEY: &'static str;
    /// Content field
    const CONTENT_KEY: &'static str = "content";
    /// The entity index for the search query
    const ENTITY_INDEX: SearchEntityType;

    /// Returns the default sort types that are used on the search query.
    /// Override this method if you need custom sort logic
    fn default_sort_types<'a>() -> Vec<SortType<'a>> {
        // Use the updated_at_sort by default
        updated_at_sort()
    }

    /// Override this method if you need custom highlight logic
    fn default_highlight<'a>() -> Highlight<'a> {
        Highlight::new().require_field_match(true).field(
            "content",
            HighlightField::new()
                .highlight_type("plain")
                .pre_tags(vec![MacroEm::Open.to_string()])
                .post_tags(vec![MacroEm::Close.to_string()])
                .number_of_fragments(500),
        )
    }

    /// Override this method if you want to add custom owner highlight fields
    /// By default, this will add a user_id highlight field
    fn append_owner_highlights<'a>(highlight: Highlight<'a>) -> Highlight<'a> {
        highlight.field("user_id", create_highlight_field("plain", 1))
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

    /// Creates the filter query to filter results to only those a user has
    /// access to/has requested.
    /// This could either be a single term/terms query for ids_only or just user_id
    /// Or a bool query that contains both of these items
    fn build_filter_query<'a>(&'a self, user_id_key: &str) -> Result<QueryType<'a>> {
        if self.ids_only {
            // We only need to search over the entity ids provided
            if self.ids.is_empty() {
                return Err(OpensearchClientError::EmptyIdsWithIdsOnly(T::ENTITY_INDEX));
            }

            // Return just the id query to filter over
            Ok(QueryType::terms(T::ID_KEY.to_string(), self.ids.to_vec()))
        } else {
            let user_id_query = QueryType::term(user_id_key.to_string(), self.user_id.clone());

            // If there are no ids provided we can return only the user id query to filter over
            if self.ids.is_empty() {
                return Ok(user_id_query);
            }

            // otherwise we need to build the filter bool query to contain both entity ids and user_id
            // Create a filter bool query that will ensure we only search over items that the user has access to
            let mut filter_bool_query = BoolQueryBuilder::new();

            // We should have either an entity_id match OR a user_id match
            filter_bool_query.minimum_should_match(1);

            filter_bool_query.should(QueryType::terms(T::ID_KEY.to_string(), self.ids.to_vec()));

            filter_bool_query.should(QueryType::term(
                user_id_key.to_string(),
                self.user_id.clone(),
            ));

            Ok(filter_bool_query.build().into())
        }
    }

    /// Builds a content bool query
    pub fn build_content_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        // We only support searching over content in opensearch now
        if self.search_on == SearchOn::Name {
            return Err(OpensearchClientError::InvalidSearchOn);
        }
        // FIXES: https://linear.app/macro-eng/issue/BAC-173/sending-invalid-queries-to-opensearch
        // If we try and build queries with ids only = true and no ids provided we should
        // error out as it creates an invalid query since we have minimum_should_match = 1.
        if self.ids_only && self.ids.is_empty() {
            return Err(OpensearchClientError::EmptyIdsWithIdsOnly(T::ENTITY_INDEX));
        }

        let mut access_bool_query = BoolQueryBuilder::new();

        // For name OR content queries, we can build a much more simple bool query
        let term_must_array: Vec<QueryType<'a>> = self.build_must_term_query(SearchOn::Content)?;

        let mut inner_bool_query = BoolQueryBuilder::new();

        inner_bool_query.minimum_should_match(1);

        // For email search, we want to search over the participants
        // For all other indices we want to search over the owner
        match T::ENTITY_INDEX {
            SearchEntityType::Emails => {
                let mut participant_queries: Vec<QueryType> = Vec::new();
                for term in &self.terms {
                    let formatted_term = format!("{}*", term);
                    participant_queries.push(
                        WildcardQuery::new("sender", formatted_term.clone(), true, Some(5000.0))
                            .into(),
                    );
                    participant_queries.push(
                        WildcardQuery::new("cc", formatted_term.clone(), true, Some(5000.0)).into(),
                    );
                    participant_queries.push(
                        WildcardQuery::new("bcc", formatted_term.clone(), true, Some(5000.0))
                            .into(),
                    );
                    participant_queries.push(
                        WildcardQuery::new(
                            "recipients",
                            formatted_term.clone(),
                            true,
                            Some(5000.0),
                        )
                        .into(),
                    );
                }

                for participant_query in participant_queries {
                    inner_bool_query.should(participant_query);
                }
            }
            _ => {
                // Create a vec of owner queries for each term
                // We want to search over the content **and** the owner here
                let mut owner_queries: Vec<QueryType> = Vec::new();
                for term in &self.terms {
                    let formatted_term = format!("macro|{}*", term);
                    owner_queries.push(
                        WildcardQuery::new(T::USER_ID_KEY, formatted_term, true, Some(5000.0))
                            .into(),
                    );
                }

                // Add the owner queries to the bool query
                for owner_query in owner_queries {
                    inner_bool_query.should(owner_query);
                }
            }
        }

        for must in term_must_array {
            inner_bool_query.should(must);
        }

        // Add in the inner bool query on content + owner to must of access bool query
        access_bool_query.must(inner_bool_query.build().into());

        // Filter over only items you have access to
        let filter_bool_query = self.build_filter_query(T::USER_ID_KEY)?;
        access_bool_query.filter(filter_bool_query);

        // Only search on the provided index
        access_bool_query.filter(QueryType::term("_index", T::ENTITY_INDEX.as_ref()));

        Ok(access_bool_query)
    }

    /// Builds the search request with the provided main bool query
    /// This will automatically wrap the bool query in a function score if
    /// SearchOn::NameContent is used
    pub fn build_search_request<'a>(
        &'a self,
        query_object: BoolQuery<'a>,
    ) -> Result<SearchRequest<'a>> {
        let mut search_request: SearchRequestBuilder<'a> = SearchRequestBuilder::new();

        // Collapse on the ID_KEY if collapse is true
        // or if we are searchign on Name or NameContent
        if self.collapse
            || self.search_on == SearchOn::Name
            || self.search_on == SearchOn::NameContent
        {
            search_request.collapse(Collapse::new(T::ID_KEY));
        }

        let mut highlight = match self.search_on {
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

        highlight = T::append_owner_highlights(highlight);

        search_request.highlight(highlight);
        search_request.set_sorts(T::default_sort_types().into());

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
                            field: "updated_at_seconds".into(),
                            origin: Some("now".into()),
                            scale: "21d".into(),
                            offset: Some("3d".into()),
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
    pub fn build_must_term_query<'a>(&'a self, search_on: SearchOn) -> Result<Vec<QueryType<'a>>> {
        let keys = Keys {
            title_key: T::TITLE_KEY,
            content_key: T::CONTENT_KEY,
        };

        if self.terms.is_empty() {
            return Err(OpensearchClientError::NoTermsProvided);
        }

        let query_key = QueryKey::from_match_type(&self.match_type)?;

        let mut must_array = Vec::new();

        let terms: Cow<'_, [&str]> =
            Cow::Owned(self.terms.iter().map(|t| t.as_str()).collect::<Vec<&str>>());

        match search_on {
            SearchOn::Name => {
                must_array.push(generate_terms_must_query(
                    query_key,
                    keys.title_key,
                    terms,
                    None,
                ));
            }
            SearchOn::Content => {
                // map all terms over content key
                must_array.push(generate_terms_must_query(
                    query_key,
                    keys.content_key,
                    terms,
                    None,
                ));
            }
            SearchOn::NameContent => unreachable!(),
        };

        Ok(must_array)
    }
}

#[cfg(test)]
mod test;
