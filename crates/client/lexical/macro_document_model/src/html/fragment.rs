//! htmlparser2 template-fragment tokenizer and stack tree construction.
//! HTML5 foster parenting/adoption rules are intentionally absent in this parser.
use lexical_html::{HtmlElement, HtmlNode};
mod entities;
mod token;
struct Frame {
    element: HtmlElement,
    svg: bool,
}
fn append(stack: &mut [Frame], root: &mut Vec<HtmlNode>, node: HtmlNode) {
    if let Some(parent) = stack.last_mut() {
        parent.element.append(node);
    } else {
        root.push(node);
    }
}
fn close(stack: &mut Vec<Frame>, root: &mut Vec<HtmlNode>) {
    if let Some(frame) = stack.pop() {
        let node = if frame.svg && frame.element.children.is_empty() {
            let tag = frame.element.tag.clone();
            let mut serialized = lexical_html::inner_html(&[HtmlNode::Element(frame.element)]);
            let suffix = format!("></{tag}>");
            if serialized.ends_with(&suffix) {
                serialized = serialized
                    .strip_suffix(&suffix)
                    .map(|prefix| format!("{prefix} />"))
                    .unwrap_or(serialized);
            } else if serialized.ends_with('>') {
                serialized.pop();
                serialized.push_str(" />");
            }
            HtmlNode::Raw(serialized)
        } else {
            HtmlNode::Element(frame.element)
        };
        append(stack, root, node);
    }
}
fn void(name: &str) -> bool {
    matches!(
        name,
        "area"
            | "base"
            | "basefont"
            | "br"
            | "col"
            | "command"
            | "embed"
            | "frame"
            | "hr"
            | "img"
            | "input"
            | "isindex"
            | "keygen"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}
fn implied(name: &str, open: &str) -> bool {
    match name {
        "tr" => matches!(open, "tr" | "th" | "td"),
        "th" => open == "th",
        "td" => matches!(open, "thead" | "th" | "td"),
        "body" => matches!(open, "head" | "link" | "script"),
        "li" => open == "li",
        "select" | "input" | "output" | "button" | "datalist" | "textarea" => matches!(
            open,
            "input" | "option" | "optgroup" | "select" | "button" | "datalist" | "textarea"
        ),
        "option" => open == "option",
        "optgroup" => matches!(open, "optgroup" | "option"),
        "dd" | "dt" => matches!(open, "dd" | "dt"),
        "rt" | "rp" => matches!(open, "rt" | "rp"),
        "tbody" | "tfoot" => matches!(open, "thead" | "tbody"),
        "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "address" | "article" | "aside"
        | "blockquote" | "details" | "div" | "dl" | "fieldset" | "figcaption" | "figure"
        | "footer" | "form" | "header" | "hr" | "main" | "nav" | "ol" | "pre" | "section"
        | "table" | "ul" => open == "p",
        _ => false,
    }
}
/// Parse stored markup into owned nodes before it can enter a template export.
pub fn parse_fragment(input: &str) -> lexical_html::Result<Vec<HtmlNode>> {
    let mut root = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut rest = input;
    let mut foreign_context = Vec::new();
    let mut doctypes = Vec::new();
    while !rest.is_empty() {
        if let Some(frame) = stack.last().filter(|frame| {
            matches!(
                frame.element.tag.as_str(),
                "script" | "style" | "title" | "textarea" | "xmp"
            )
        }) {
            let tag = frame.element.tag.clone();
            let svg = frame.svg;
            let (tail, content) = token::raw_text(rest, &tag);
            if !content.is_empty() {
                let content = if tag == "title" {
                    entities::title(&content)?
                } else {
                    content
                };
                append(
                    &mut stack,
                    &mut root,
                    if tag != "xmp" && !svg {
                        HtmlNode::Raw(content)
                    } else {
                        HtmlNode::Text(content)
                    },
                );
                rest = tail;
                if rest.is_empty() {
                    break;
                }
            }
        }
        let (tail, token) = token::next(rest)?;
        rest = tail;
        match token {
            token::Token::Ignore => {}
            token::Token::Text(value) => {
                for part in entities::chunks(value, false)? {
                    append(&mut stack, &mut root, HtmlNode::Text(part));
                }
            }
            token::Token::Cdata(value) => append(
                &mut stack,
                &mut root,
                HtmlNode::Raw(format!("<!--[CDATA[{value}]]-->")),
            ),
            token::Token::Comment(value) => append(
                &mut stack,
                &mut root,
                HtmlNode::Raw(format!("<!--{value}-->")),
            ),
            token::Token::Directive(value) => {
                let (tail, name) = token::directive_name(value)?;
                if name.eq_ignore_ascii_case("doctype") {
                    if let Some(node) = doctype(tail.trim())? {
                        doctypes.insert(0, node);
                    }
                } else if value.starts_with("[CDATA[") {
                    append(
                        &mut stack,
                        &mut root,
                        HtmlNode::Raw(format!("<!--{value}-->")),
                    );
                }
            }
            token::Token::Close(name) => {
                if matches!(
                    name.as_str(),
                    "svg"
                        | "math"
                        | "mi"
                        | "mo"
                        | "mn"
                        | "ms"
                        | "mtext"
                        | "annotation-xml"
                        | "foreignobject"
                        | "desc"
                        | "title"
                ) {
                    foreign_context.pop();
                }
                if !void(&name) {
                    if let Some(index) = stack.iter().rposition(|frame| frame.element.tag == name) {
                        while stack.len() > index {
                            close(&mut stack, &mut root);
                        }
                    } else if name == "p" {
                        let svg = stack.last().is_some_and(|frame| frame.svg);
                        stack.push(Frame {
                            element: HtmlElement::new("p"),
                            svg,
                        });
                        close(&mut stack, &mut root);
                    }
                } else if name == "br" {
                    let svg = stack.last().is_some_and(|frame| frame.svg);
                    stack.push(Frame {
                        element: HtmlElement::new("br"),
                        svg,
                    });
                    close(&mut stack, &mut root);
                }
            }
            token::Token::Open {
                name,
                attributes,
                self_close,
            } => {
                while stack
                    .last()
                    .is_some_and(|frame| implied(&name, &frame.element.tag))
                {
                    close(&mut stack, &mut root);
                }
                let svg = name == "svg" || stack.last().is_some_and(|frame| frame.svg);
                if matches!(name.as_str(), "math" | "svg") {
                    foreign_context.push(true);
                } else if matches!(
                    name.as_str(),
                    "mi" | "mo"
                        | "mn"
                        | "ms"
                        | "mtext"
                        | "annotation-xml"
                        | "foreignobject"
                        | "desc"
                        | "title"
                ) {
                    foreign_context.push(false);
                }
                let foreign = foreign_context.last().copied().unwrap_or(false);
                let mut element = HtmlElement::new(&name);
                for (name, value) in attributes.into_iter().rev() {
                    element.set_attribute(&name, value);
                }
                stack.push(Frame { element, svg });
                if void(&name) || (self_close && foreign) {
                    close(&mut stack, &mut root);
                }
            }
        }
    }
    while !stack.is_empty() {
        close(&mut stack, &mut root);
    }
    if doctypes.is_empty() || root.len() <= 1 {
        doctypes.extend(root);
    }
    Ok(doctypes)
}
fn doctype(value: &str) -> lexical_html::Result<Option<HtmlNode>> {
    static PATTERN: std::sync::LazyLock<std::result::Result<regress::Regex, regress::Error>> =
        std::sync::LazyLock::new(|| {
            regress::Regex::with_flags(
                r#"^([a-z:]+)(\s+system|\s+public(\s+"([^"]+)")?)?(\s+"([^"]+)")?"#,
                "i",
            )
        });
    let pattern = PATTERN
        .as_ref()
        .map_err(|_| lexical_html::Error::InvalidExport("invalid doctype pattern"))?;
    Ok(pattern.find(value).map(|matched| {
        let group = |index| {
            matched
                .group(index)
                .and_then(|range| value.get(range))
                .unwrap_or("")
        };
        let mut text = format!("<!DOCTYPE {}", group(1));
        if !group(4).is_empty() {
            text.push_str(&format!(" PUBLIC \"{}\"", group(4)));
        }
        if !group(6).is_empty() {
            if group(4).is_empty() {
                text.push_str(" SYSTEM");
            }
            text.push_str(&format!(" \"{}\"", group(6)));
        }
        text.push('>');
        HtmlNode::Raw(text)
    }))
}
