pub fn count_occurrences(strings: Vec<String>) -> Vec<(String, i64)> {
    use std::collections::HashMap;

    let mut counts = HashMap::new();

    // Count each SHA's occurrences
    for string in strings {
        *counts.entry(string).or_insert(0) += 1;
    }

    // Convert the HashMap into a Vec of tuples
    counts
        .into_iter()
        .map(|(string, count)| (string, count as i64))
        .collect()
}
