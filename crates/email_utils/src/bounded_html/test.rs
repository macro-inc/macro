use super::*;

#[test]
fn attributes_spread_over_elements_count_toward_the_node_limit() {
    // Three attributes an element: every four still cost a node.
    let within = "<br a b c>".repeat(130_000);
    let past = "<br a b c>".repeat(150_000);

    assert!(!parse_document(&within).clipped);
    assert!(parse_document(&past).clipped);
}

#[test]
fn a_repeated_body_counts_only_the_attributes_it_adds() {
    let attributes =
        |range: std::ops::Range<usize>| -> String { range.map(|i| format!(" a{i}")).collect() };
    let repeated = format!("<body{}><body{}>x", attributes(0..600), attributes(0..600));
    let added = format!(
        "<body{}><body{}>x",
        attributes(0..600),
        attributes(600..1_200)
    );

    assert!(!parse_document(&repeated).clipped);
    assert!(parse_document(&added).clipped);
}

#[test]
fn a_template_counts_its_contents_node() {
    let within = "<template></template>".repeat(120_000);
    let past = "<template></template>".repeat(130_000);

    assert!(!parse_document(&within).clipped);
    assert!(parse_document(&past).clipped);
}
