use super::*;
#[test]
fn attributes_styles_classes_and_text_match_linkedom_literals() {
    let mut element = HtmlElement::new("DIV");
    element.set_attribute("id", "");
    element.set_attribute("data-value", "a&<\"b");
    element.set_attribute("contenteditable", "");
    element.set_attribute("style", "color: red; padding: 1px;");
    element.style_set_property("backgroundColor", "blue");
    element.style_set_property("color", "green");
    element.class_list_add(["a", "a", "b"]);
    element.append(HtmlNode::Text("<&>\u{a0}\"'".into()));
    assert_eq!(
        inner_html(&[HtmlNode::Element(element)]),
        "<DIV class=\"a b\" style=\"color:green;padding:1px;background-color:blue\" contenteditable data-value=\"a&<&quot;b\">&lt;&amp;&gt;&#160;\"'</DIV>"
    );
    let mut img = HtmlElement::new("IMG");
    img.set_attribute("width", "0");
    img.set_attribute("src", "x&y");
    img.set_attribute("width", "20");
    img.append(HtmlNode::Text("ignored".into()));
    assert_eq!(
        inner_html(&[HtmlNode::Element(img)]),
        "<IMG src=\"x&y\" width=\"20\">ignored</IMG>"
    );
}
#[test]
fn fragments_and_css_follow_linkedom_maps() {
    let mut element = HtmlElement::new("p");
    element.append(HtmlNode::Fragment(vec![
        HtmlNode::Text("a".into()),
        HtmlNode::Text("b".into()),
    ]));
    crate::css::set_dom_style_from_css(
        &mut element,
        "color: red !IMPORTANT; color: blue; --a: 1; x: url('a;b')",
    );
    assert_eq!(
        inner_html(&[HtmlNode::Element(element)]),
        "<p style=\"color:blue;--a:1;x:url('a;b')\">ab</p>"
    );
    assert_eq!(crate::css::uhyphen("XMLHttpRequest"), "xml-http-request");
    assert_eq!(crate::js::btoa("é"), Some("6Q==".into()));
    assert_eq!(crate::js::btoa("😀"), None);
    assert_eq!(crate::js::btoa_or_utf8("😀"), "8J+YgA==");
}

#[test]
fn initial_list_value_is_not_a_reflected_headless_attribute() {
    let mut element = HtmlElement::new("li");
    element.set_attribute("role", "checkbox");
    element.set_initial_list_item_value(7);
    element.set_attribute("class", "item");
    assert_eq!(element.get_attribute("value"), None);
    assert_eq!(
        element
            .dom_construction()
            .map(|(name, value, _, property)| (name, value, property))
            .collect::<Vec<_>>(),
        vec![
            ("role", "checkbox".into(), false),
            ("value", "7".into(), true),
            ("class", "item".into(), false),
        ]
    );
    assert_eq!(
        inner_html(&[HtmlNode::Element(element)]),
        "<li class=\"item\" role=\"checkbox\"></li>"
    );
}
