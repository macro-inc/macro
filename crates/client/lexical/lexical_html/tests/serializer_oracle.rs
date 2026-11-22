//! Builder operation sequences compared with the pinned linkedom serializer.
use lexical_html::{HtmlElement, HtmlNode, inner_html};
#[derive(serde::Deserialize)]
struct Case {
    name: String,
    tag: String,
    ops: Vec<Vec<String>>,
    html: String,
}
#[test]
fn serializer_matches_linkedom_goldens() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("corpus/serializer.json")).unwrap();
    for case in cases {
        let mut element = HtmlElement::new(&case.tag);
        for op in case.ops {
            match op[0].as_str() {
                "attr" => element.set_attribute(&op[1], &op[2]),
                "style" => element.style_set_property(&op[1], &op[2]),
                "removeStyle" => element.style_remove_property(&op[1]),
                "class" => element.class_list_add([op[1].as_str()]),
                "text" => element.set_text_content(&op[1]),
                other => panic!("unknown oracle operation {other}"),
            }
        }
        assert_eq!(
            inner_html(&[HtmlNode::Element(element)]),
            case.html,
            "{}",
            case.name
        );
    }
}
