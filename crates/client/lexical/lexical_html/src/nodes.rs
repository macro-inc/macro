//! Shared element and text DOM construction, reused by package subclasses.
use crate::*;
use lexical_model::*;
mod core;
/// Apply ElementNode.exportDOM indentation and direction, in upstream order.
pub fn element_export_dom(
    ctx: &ExportCtx<'_>,
    key: NodeKey,
    element: &mut HtmlElement,
) -> crate::Result<()> {
    let data = ctx.state.element_data(key)?;
    if data.indent > 0 {
        element.style_set_property(
            "padding-inline-start",
            &format!("{}px", u64::from(data.indent) * 40),
        );
        element.set_attribute("data-lexical-indent", data.indent.to_string());
    }
    if let Some(direction) = data.direction {
        element.set_attribute(
            "dir",
            match direction {
                TextDirection::Ltr => "ltr",
                TextDirection::Rtl => "rtl",
            },
        );
    }
    Ok(())
}
/// Alignment name, absent for the unformatted default.
pub fn element_format_str(format: ElementFormat) -> Option<&'static str> {
    match format {
        ElementFormat::Unset => None,
        ElementFormat::Left => Some("left"),
        ElementFormat::Start => Some("start"),
        ElementFormat::Center => Some("center"),
        ElementFormat::Right => Some("right"),
        ElementFormat::End => Some("end"),
        ElementFormat::Justify => Some("justify"),
    }
}
/// Create the text DOM before export's extra wrappers and whitespace styles.
pub fn text_create_dom(ctx: &ExportCtx<'_>, key: NodeKey) -> crate::Result<HtmlElement> {
    let data = ctx.state.text_data(key)?;
    let format = data.format;
    let outer = if format.contains(TextFormat::CODE) {
        Some("code")
    } else if format.contains(TextFormat::HIGHLIGHT) {
        Some("mark")
    } else if format.contains(TextFormat::SUBSCRIPT) {
        Some("sub")
    } else if format.contains(TextFormat::SUPERSCRIPT) {
        Some("sup")
    } else {
        None
    };
    let inner = if format.contains(TextFormat::BOLD) {
        "strong"
    } else if format.contains(TextFormat::ITALIC) {
        "em"
    } else {
        "span"
    };
    let mut inner = HtmlElement::new(inner);
    inner.set_text_content(ctx.text(key));
    if let Some(theme) = &ctx.theme.text {
        css::add_class_names(&mut inner, &[theme.base.as_deref()]);
        let combined = format.contains(TextFormat::UNDERLINE | TextFormat::STRIKETHROUGH)
            && theme.underline_strikethrough.is_some();
        if combined {
            css::add_class_names(&mut inner, &[theme.underline_strikethrough.as_deref()]);
        }
        for (flag, class) in [
            (TextFormat::BOLD, &theme.bold),
            (TextFormat::CAPITALIZE, &theme.capitalize),
            (TextFormat::CODE, &theme.code),
            (TextFormat::HIGHLIGHT, &theme.highlight),
            (TextFormat::ITALIC, &theme.italic),
            (TextFormat::LOWERCASE, &theme.lowercase),
            (TextFormat::STRIKETHROUGH, &theme.strikethrough),
            (TextFormat::SUBSCRIPT, &theme.subscript),
            (TextFormat::SUPERSCRIPT, &theme.superscript),
            (TextFormat::UNDERLINE, &theme.underline),
            (TextFormat::UPPERCASE, &theme.uppercase),
        ] {
            if format.contains(flag)
                && !(combined
                    && (flag == TextFormat::UNDERLINE || flag == TextFormat::STRIKETHROUGH))
            {
                css::add_class_names(&mut inner, &[class.as_deref()]);
            }
        }
    }
    let mut element = if let Some(outer) = outer {
        let mut element = HtmlElement::new(outer);
        if format.contains(TextFormat::CODE) {
            element.set_attribute("spellcheck", "false");
        }
        element.append(HtmlNode::Element(inner));
        element
    } else {
        inner
    };
    if !data.style.is_empty() {
        css::set_dom_style_from_css(&mut element, &data.style);
    }
    Ok(element)
}
/// Apply TextNode.exportDOM whitespace, transform and semantic wrappers.
pub fn text_export_dom(
    ctx: &ExportCtx<'_>,
    key: NodeKey,
    mut element: HtmlElement,
) -> crate::Result<HtmlNode> {
    let format = ctx.state.text_data(key)?.format;
    element.style_set_property("white-space", "pre-wrap");
    let transform = if format.contains(TextFormat::LOWERCASE) {
        Some("lowercase")
    } else if format.contains(TextFormat::UPPERCASE) {
        Some("uppercase")
    } else if format.contains(TextFormat::CAPITALIZE) {
        Some("capitalize")
    } else {
        None
    };
    if let Some(transform) = transform {
        element.style_set_property("text-transform", transform);
    }
    let mut node = HtmlNode::Element(element);
    for (flag, tag) in [
        (TextFormat::BOLD, "b"),
        (TextFormat::ITALIC, "i"),
        (TextFormat::STRIKETHROUGH, "s"),
        (TextFormat::UNDERLINE, "u"),
    ] {
        if format.contains(flag) {
            let mut outer = HtmlElement::new(tag);
            outer.append(node);
            node = HtmlNode::Element(outer);
        }
    }
    Ok(node)
}
/// Shared block export tail for paragraphs, headings and quotes.
pub fn block_export_dom<'a>(
    ctx: &ExportCtx<'a>,
    key: NodeKey,
    tag: &str,
    class: Option<&str>,
) -> crate::Result<DomExportOutput<'a>> {
    let mut element = HtmlElement::new(tag);
    css::add_class_names(&mut element, &[class]);
    element_export_dom(ctx, key, &mut element)?;
    if ctx.state.children_size(key) == 0 {
        element.append(HtmlNode::Element(HtmlElement::new("br")));
    }
    if let Some(align) = element_format_str(ctx.state.element_data(key)?.format) {
        element.style_set_property("text-align", align);
    }
    Ok(DomExportOutput::element(element))
}
