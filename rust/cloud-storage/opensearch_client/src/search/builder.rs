use std::borrow::Cow;

use crate::Result;
use crate::error::OpensearchClientError;
use crate::search::query::QueryKey;
use crate::search::query::generate_terms_must_query;
use models_opensearch::OpenSearchEntityType;
use models_search_cursor::SearchMethodCursor;
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, QueryType, Script, ScriptSort, ScriptSortType, SortOrder, SortType,
};

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

/// Creates sort vec to sort by sent_at_seconds (preferred) or updated_at_seconds (fallback)
/// with entity_id as a tiebreaker. Items without a timestamp are pushed to the end.
pub(crate) fn updated_at_sort<'a>() -> Vec<SortType<'a>> {
    vec![
        SortType::ScriptSort(ScriptSort::new(
            Script::new(
                r#"if (doc.containsKey('sent_at_seconds') && doc['sent_at_seconds'].size() > 0) {
                    return doc['sent_at_seconds'].value.toInstant().toEpochMilli();
                } else if (doc.containsKey('updated_at_seconds') && doc['updated_at_seconds'].size() > 0) {
                    return doc['updated_at_seconds'].value.toInstant().toEpochMilli();
                } else {
                    return 0L;
                }"#,
            ),
            ScriptSortType::Number,
            SortOrder::Desc,
        )),
        SortType::Field(FieldSort::new("entity_id", SortOrder::Asc)),
    ]
}

pub(crate) fn search_after(cursor: SearchMethodCursor) -> Vec<serde_json::Value> {
    vec![
        serde_json::json!(cursor.updated_at.timestamp_millis()),
        serde_json::json!(cursor.entity_id.to_string()),
    ]
}

pub trait SearchQueryConfig {
    /// Key for item id
    const ID_KEY: &'static str = "entity_id";
    /// Key for user id. Required for `ids_only = false`; leave `None` for
    /// indices that only support `ids_only = true` (access comes from the
    /// caller-supplied id allowlist).
    const USER_ID_KEY: Option<&'static str> = None;
    /// Key for title
    const TITLE_KEY: &'static str;
    /// Content field
    const CONTENT_KEY: &'static str = "content";
    /// The entity index for the search query
    const ENTITY_INDEX: OpenSearchEntityType;
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
    /// Whether to collapse the results to be a single result per ID_KEY
    /// Defaults to false.
    pub collapse: bool,
    /// If true, only search over the set of ids instead of ids + user_id.
    /// Defaults to false.
    pub ids_only: bool,
    /// The ids to search for defaults to an empty vector
    pub ids: Vec<String>,
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
            collapse: false,
            ids_only: false,
            ids: Vec::new(),
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

    /// Creates the filter query to filter results to only those a user has
    /// access to/has requested.
    /// This could either be a single term/terms query for ids_only or just user_id
    /// Or a bool query that contains both of these items
    fn build_filter_query<'a>(&'a self, user_id_key: Option<&str>) -> Result<QueryType<'a>> {
        if self.ids_only {
            // We only need to search over the entity ids provided
            if self.ids.is_empty() {
                return Err(OpensearchClientError::EmptyIdsWithIdsOnly(T::ENTITY_INDEX));
            }

            // Return just the id query to filter over
            Ok(QueryType::terms(T::ID_KEY.to_string(), self.ids.to_vec()))
        } else {
            let user_id_key =
                user_id_key.ok_or(OpensearchClientError::UserIdKeyRequired(T::ENTITY_INDEX))?;
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
        if self.ids_only && self.ids.is_empty() {
            return Err(OpensearchClientError::EmptyIdsWithIdsOnly(T::ENTITY_INDEX));
        }

        let mut access_bool_query = BoolQueryBuilder::new();

        let term_must_array: Vec<QueryType<'a>> = self.build_must_term_query()?;

        let mut inner_bool_query = BoolQueryBuilder::new();

        inner_bool_query.minimum_should_match(1);

        for must in term_must_array {
            inner_bool_query.should(must);
        }

        // Add in the inner bool query on content + owner to must of access bool query
        access_bool_query.must(inner_bool_query.build().into());

        // Filter over only items you have access to
        let filter_bool_query = self.build_filter_query(T::USER_ID_KEY)?;
        access_bool_query.filter(filter_bool_query);

        // Only search on the provided index
        access_bool_query.filter(QueryType::term("_index", T::ENTITY_INDEX.index_name()));

        Ok(access_bool_query)
    }

    pub fn build_must_term_query<'a>(&'a self) -> Result<Vec<QueryType<'a>>> {
        if self.terms.is_empty() {
            return Err(OpensearchClientError::NoTermsProvided);
        }

        let query_key = QueryKey::from_match_type(&self.match_type)?;

        let terms: Cow<'_, [&str]> =
            Cow::Owned(self.terms.iter().map(|t| t.as_str()).collect::<Vec<&str>>());

        let must_array = vec![generate_terms_must_query(query_key, T::CONTENT_KEY, terms)];

        Ok(must_array)
    }

    /// Builds a query targeting the title field (TITLE_KEY)
    pub fn build_title_term_query<'a>(&'a self) -> Result<QueryType<'a>> {
        if self.terms.is_empty() {
            return Err(OpensearchClientError::NoTermsProvided);
        }

        let query_key = QueryKey::from_match_type(&self.match_type)?;
        let terms: Cow<'_, [&str]> =
            Cow::Owned(self.terms.iter().map(|t| t.as_str()).collect::<Vec<&str>>());

        Ok(generate_terms_must_query(query_key, T::TITLE_KEY, terms))
    }
}

#[cfg(test)]
mod test;
