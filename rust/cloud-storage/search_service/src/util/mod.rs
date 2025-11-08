use models_search::{ItemId, Metadata, SearchResponseItem};
use std::collections::BTreeMap;

/// Key struct that encodes rank for proper BTreeMap ordering.
/// Items are ordered first by rank, then by ID as tiebreaker.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RankedKey {
    rank: u64,
    id: String,
}

impl Ord for RankedKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.rank
            .cmp(&other.rank)
            .then_with(|| self.id.cmp(&other.id))
    }
}

impl PartialOrd for RankedKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

type SearchResultsMap<T> = BTreeMap<RankedKey, Vec<T>>;

fn build_search_results_map<T>(search_results: Vec<T>) -> SearchResultsMap<T>
where
    T: ItemId,
{
    let mut search_results_map: SearchResultsMap<T> = BTreeMap::new();
    let mut rank = 0;
    let mut id_to_rank = std::collections::HashMap::new();

    // Assign ranks based on first appearance
    for result in &search_results {
        let id = result.get_id();
        if !id_to_rank.contains_key(id) {
            id_to_rank.insert(id.clone(), rank);
            let ranked_key = RankedKey {
                rank,
                id: id.clone(),
            };
            search_results_map.insert(ranked_key, vec![]);
            rank += 1;
        }
    }

    // Populate with results
    for result in search_results {
        let id = result.get_id();
        let rank = id_to_rank[id];
        let ranked_key = RankedKey {
            rank,
            id: id.clone(),
        };
        search_results_map
            .get_mut(&ranked_key)
            .unwrap()
            .push(result);
    }

    search_results_map
}

fn build_search_results<T, U, V>(
    search_results_map: SearchResultsMap<T>,
) -> Vec<SearchResponseItem<U, V>>
where
    Option<U>: for<'a> From<&'a T>,
    T: Metadata<V>,
{
    let mut result = vec![];

    for (ranked_key, search_results) in search_results_map {
        if search_results.is_empty() {
            tracing::warn!("no search results found for id {}", ranked_key.id);
            continue;
        }

        let base_search_result = &search_results[0];

        let filtered_results: Vec<U> = search_results
            .iter()
            .filter_map(|result| result.into())
            .collect();

        let metadata: V = base_search_result.metadata(&ranked_key.id);

        let response_item = SearchResponseItem {
            results: filtered_results,
            metadata,
        };

        result.push(response_item);
    }

    result
}

pub fn construct_search_result<T, U, V>(
    search_results: Vec<T>,
) -> anyhow::Result<Vec<SearchResponseItem<U, V>>>
where
    T: ItemId + Metadata<V>,
    Option<U>: for<'a> From<&'a T>,
{
    let search_results_map = build_search_results_map(search_results);
    let result = build_search_results(search_results_map);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_search::{ItemId, Metadata};

    #[derive(Clone, Debug, PartialEq)]
    struct TestItem {
        id: String,
        data: String,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct TestMetadata {
        value: String,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct TestResult {
        content: String,
    }

    impl ItemId for TestItem {
        fn get_id(&self) -> &String {
            &self.id
        }
    }

    impl Metadata<TestMetadata> for TestItem {
        fn metadata(&self, _id: &str) -> TestMetadata {
            TestMetadata {
                value: self.data.clone(),
            }
        }
    }

    impl<'a> From<&'a TestItem> for Option<TestResult> {
        fn from(item: &'a TestItem) -> Self {
            Some(TestResult {
                content: item.data.clone(),
            })
        }
    }

    #[test]
    fn test_construct_search_result_deterministic_output() {
        // This test is expected to fail due to HashMap iteration order being non-deterministic
        let search_results = vec![
            TestItem {
                id: "item1".to_string(),
                data: "data1".to_string(),
            },
            TestItem {
                id: "item2".to_string(),
                data: "data2".to_string(),
            },
            TestItem {
                id: "item3".to_string(),
                data: "data3".to_string(),
            },
        ];

        // Run the function multiple times with identical inputs
        let result1 = construct_search_result(search_results.clone()).unwrap();
        let result2 = construct_search_result(search_results.clone()).unwrap();
        let result3 = construct_search_result(search_results.clone()).unwrap();

        // Extract the order of metadata values to compare
        let order1: Vec<String> = result1
            .iter()
            .map(|item| item.metadata.value.clone())
            .collect();
        let order2: Vec<String> = result2
            .iter()
            .map(|item| item.metadata.value.clone())
            .collect();
        let order3: Vec<String> = result3
            .iter()
            .map(|item| item.metadata.value.clone())
            .collect();

        // This assertion should fail due to non-deterministic HashMap iteration order
        // The items may appear in different orders in the results
        assert_eq!(
            order1, order2,
            "Results should be identical for identical inputs (run 1 vs 2)"
        );
        assert_eq!(
            order2, order3,
            "Results should be identical for identical inputs (run 2 vs 3)"
        );
        assert_eq!(
            order1, order3,
            "Results should be identical for identical inputs (run 1 vs 3)"
        );
    }

    #[test]
    fn test_construct_search_result_preserves_input_ranking() {
        // Test that the ordering of output matches the ranking from input order
        let search_results = vec![
            TestItem {
                id: "first".to_string(),
                data: "first_data".to_string(),
            },
            TestItem {
                id: "second".to_string(),
                data: "second_data".to_string(),
            },
            TestItem {
                id: "third".to_string(),
                data: "third_data".to_string(),
            },
            TestItem {
                id: "fourth".to_string(),
                data: "fourth_data".to_string(),
            },
        ];

        let result = construct_search_result(search_results).unwrap();

        // Extract the order of metadata values from the result
        let output_order: Vec<String> = result
            .iter()
            .map(|item| item.metadata.value.clone())
            .collect();

        // The output should preserve the input ordering
        let expected_order = vec![
            "first_data".to_string(),
            "second_data".to_string(),
            "third_data".to_string(),
            "fourth_data".to_string(),
        ];

        assert_eq!(
            output_order, expected_order,
            "Output ordering should match input ranking order"
        );
    }
}
