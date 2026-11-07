use super::*;

#[test]
fn run_properties_sort_in_schema_order() {
    let mut order: Vec<&str> = vec![
        "w:rPrChange",
        "w14:ligatures",
        "w:sz",
        "w:rFonts",
        "w:rStyle",
    ];
    order.sort_by_key(|q| rpr_rank(q));
    assert_eq!(
        order,
        vec![
            "w:rStyle",
            "w:rFonts",
            "w:sz",
            "w14:ligatures",
            "w:rPrChange"
        ]
    );
}

#[test]
fn escapes_text() {
    assert_eq!(text_xml("a<b&c"), "a&lt;b&amp;c");
}
