use crate::SearchOn;
use crate::{Result, search::query::Keys, search::query::build_top_level_bool};
use opensearch_query_builder::*;

use serde_json::{Map, Value};

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

    /// Override this method if you need custom sorting logic
    fn default_sort() -> Value {
        serde_json::json!([
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
        ])
    }

    /// Override this method if you need custom highlight logic
    fn default_highlight() -> Value {
        serde_json::json!({
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                    "require_field_match": true,
        }
            }
        })
    }
}

#[derive(Default)]
pub struct SearchQueryBuilder<T: SearchQueryConfig> {
    /// The terms to search for
    terms: Vec<String>,
    /// The match type to use when searching
    /// Defaults to "exact"
    match_type: String,
    /// The page number to start at
    /// Defaults to 0
    page: i64,
    /// The page size to use
    /// Defaults to 10
    page_size: i64,
    /// The user id to search for
    user_id: String,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    search_on: SearchOn,
    /// Whether to collapse the results to be a single result per ID_KEY
    /// Defaults to false.
    collapse: bool,
    /// If true, only search over the set of ids instead of ids + user_id.
    /// Defaults to false.
    ids_only: bool,
    /// The ids to search for defaults to an empty vector
    ids: Vec<String>,

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
            _phantom: std::marker::PhantomData,
        }
    }

    pub fn match_type(mut self, match_type: &str) -> Self {
        self.match_type = match_type.to_string();
        self
    }

    pub fn page(mut self, page: i64) -> Self {
        self.page = page;
        self
    }

    pub fn page_size(mut self, page_size: i64) -> Self {
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

    pub fn query_builder(&self) -> Result<BoolQueryBuilder> {
        let keys = Keys {
            id_key: T::ID_KEY,
            user_id_key: T::USER_ID_KEY,
            title_key: T::TITLE_KEY,
            content_key: T::CONTENT_KEY,
        };

        build_top_level_bool(
            &self.terms,
            &self.match_type,
            keys,
            &self.ids,
            &self.user_id,
            self.search_on,
            self.ids_only,
        )
    }

    pub fn build_with_query(self, query_object: QueryType) -> Result<Value> {
        let query_object = query_object.to_json();
        let from = self.page * self.page_size;

        let mut query_map = Map::new();
        query_map.insert("query".to_string(), query_object);
        query_map.insert("from".to_string(), serde_json::json!(from));
        query_map.insert("size".to_string(), serde_json::json!(self.page_size));
        query_map.insert("sort".to_string(), T::default_sort());
        query_map.insert("highlight".to_string(), T::default_highlight());

        // If collapse is true or searching only on Name, collapse the id field to remove duplicate
        // results for pagination
        if self.collapse || self.search_on == SearchOn::Name {
            query_map.insert(
                "collapse".to_string(),
                serde_json::json!({ "field": T::ID_KEY }),
            );
        }

        Ok(Value::Object(query_map))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestSearchConfig;

    impl SearchQueryConfig for TestSearchConfig {
        const ID_KEY: &'static str = "test_id";
        const INDEX: &'static str = "test_index";
        const USER_ID_KEY: &'static str = "test_user_id";
        const TITLE_KEY: &'static str = "test_title";
    }

    #[test]
    fn test_search_query_builder_build() {
        let terms = vec!["search".to_string(), "term".to_string()];
        let ids = vec!["id1".to_string(), "id2".to_string()];
        let user_id = "user123";
        let page = 1;
        let page_size = 20;

        let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
            .match_type("exact")
            .page(page)
            .page_size(page_size)
            .user_id(user_id)
            .ids(ids.clone());

        let query = builder.query_builder().unwrap().build();
        let result = builder.build_with_query(query).unwrap();

        // Verify the structure contains expected keys
        assert!(result.get("query").is_some());
        assert!(result.get("from").is_some());
        assert!(result.get("size").is_some());
        assert!(result.get("sort").is_some());
        assert!(result.get("highlight").is_some());

        // Verify pagination values
        assert_eq!(result["from"], serde_json::json!(page * page_size));
        assert_eq!(result["size"], serde_json::json!(page_size));

        // Verify sort structure (using default)
        let expected_sort = serde_json::json!([
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
        ]);
        assert_eq!(result["sort"], expected_sort);

        // Verify highlight structure (using default)
        let expected_highlight = serde_json::json!({
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                    "require_field_match": true,
                }
            }
        });
        assert_eq!(result["highlight"], expected_highlight);

        // Verify query structure contains bool query
        assert!(result["query"]["bool"].is_object());

        // Verify should clause contains user_id and ids terms
        let should_clause = &result["query"]["bool"]["should"];
        assert!(should_clause.is_array());

        let should_array = should_clause.as_array().unwrap();
        assert_eq!(should_array.len(), 2);

        // Check for user_id term
        let user_term_found = should_array.iter().any(|item| {
            item.get("term")
                .and_then(|t| t.get("test_user_id"))
                .map(|v| v == user_id)
                .unwrap_or(false)
        });
        assert!(user_term_found);

        // Check for ids terms
        let ids_term_found = should_array.iter().any(|item| {
            item.get("terms")
                .and_then(|t| t.get("test_id"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.len() == 2)
                .unwrap_or(false)
        });
        assert!(ids_term_found);
    }
}
