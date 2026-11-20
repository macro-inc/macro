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
fn a_template_counts_its_contents_node() {
    let within = "<template></template>".repeat(120_000);
    let past = "<template></template>".repeat(130_000);

    assert!(!parse_document(&within).clipped);
    assert!(parse_document(&past).clipped);
}
