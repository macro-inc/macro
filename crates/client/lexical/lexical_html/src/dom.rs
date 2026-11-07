//! DOM-like owned nodes with linkedom attribute, style and fragment semantics.
use lexical_model::NodeKey;
/// An output node; raw markup must come from a trusted parser/serializer.
#[derive(Clone, Debug, PartialEq)]
pub enum HtmlNode {
    /// An owned element.
    Element(HtmlElement),
    /// Text, escaped during serialization.
    Text(String),
    /// A fragment, spliced when appended.
    Fragment(Vec<HtmlNode>),
    /// Already serialized markup, reserved for parser output.
    Raw(String),
}
/// Element attributes retain insertion order and serialize in reverse order.
#[derive(Clone, Debug, PartialEq)]
pub struct HtmlElement {
    /// Case-preserving tag name.
    pub tag: String,
    pub(crate) attrs: Vec<Attr>,
    /// Child nodes in insertion order.
    pub children: Vec<HtmlNode>,
    /// Internal table-cell identity, never serialized.
    pub lexical_key: Option<NodeKey>,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Attr {
    pub name: String,
    pub value: AttrValue,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum AttrValue {
    Plain(String),
    Class(Vec<String>),
    Style(Vec<(String, String)>),
}
impl AttrValue {
    pub(crate) fn string(&self) -> String {
        match self {
            Self::Plain(value) => value.clone(),
            Self::Class(tokens) => tokens.join(" "),
            Self::Style(properties) => properties
                .iter()
                .map(|(key, value)| format!("{key}:{value}"))
                .collect::<Vec<_>>()
                .join(";"),
        }
    }
}
impl HtmlElement {
    /// Create an empty element without attributes.
    pub fn new(tag: impl Into<String>) -> Self {
        Self {
            tag: tag.into(),
            attrs: Vec::new(),
            children: Vec::new(),
            lexical_key: None,
        }
    }
    fn set(&mut self, name: &str, value: AttrValue) {
        if let Some(attr) = self.attrs.iter_mut().find(|attr| attr.name == name) {
            attr.value = value;
        } else {
            self.attrs.push(Attr {
                name: name.to_owned(),
                value,
            });
        }
    }
    /// Set an attribute in place, preserving its original position.
    pub fn set_attribute(&mut self, name: &str, value: impl Into<String>) {
        let value = value.into();
        if name == "class" {
            self.set_class_name(&value);
        } else {
            self.set(name, AttrValue::Plain(value));
        }
    }
    /// Remove a named attribute.
    pub fn remove_attribute(&mut self, name: &str) {
        self.attrs.retain(|attr| attr.name != name);
    }
    /// Read the current attribute string.
    pub fn get_attribute(&self, name: &str) -> Option<String> {
        self.attrs
            .iter()
            .find(|attr| attr.name == name)
            .map(|attr| attr.value.string())
    }
    /// Add verbatim class tokens, skipping only empty tokens and duplicates.
    pub fn class_list_add<'s>(&mut self, tokens: impl IntoIterator<Item = &'s str>) {
        let mut classes = match self
            .attrs
            .iter()
            .find(|attr| attr.name == "class")
            .map(|attr| &attr.value)
        {
            Some(AttrValue::Class(tokens)) => tokens.clone(),
            Some(value) => value
                .string()
                .split(lexical_model::is_js_whitespace)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect(),
            None => Vec::new(),
        };
        for token in tokens {
            if !token.is_empty() && !classes.iter().any(|class| class == token) {
                classes.push(token.to_owned());
            }
        }
        self.set("class", AttrValue::Class(classes));
    }
    /// Replace all classes using JavaScript whitespace splitting.
    pub fn set_class_name(&mut self, value: &str) {
        let mut classes = Vec::new();
        for token in value
            .split(lexical_model::is_js_whitespace)
            .filter(|token| !token.is_empty())
        {
            if !classes.iter().any(|class| class == token) {
                classes.push(token.to_owned());
            }
        }
        self.set("class", AttrValue::Class(classes));
    }
    fn styles(&self) -> Vec<(String, String)> {
        match self
            .attrs
            .iter()
            .find(|attr| attr.name == "style")
            .map(|attr| &attr.value)
        {
            Some(AttrValue::Style(styles)) => styles.clone(),
            Some(value) => crate::css::raw_style_pairs(&value.string()),
            None => Vec::new(),
        }
    }
    /// Set a CSS property, ignoring priority and retaining existing property order.
    pub fn style_set_property(&mut self, name: &str, value: &str) {
        let name = crate::css::uhyphen(name);
        let mut styles = self.styles();
        if let Some((_, previous)) = styles.iter_mut().find(|(key, _)| key == &name) {
            *previous = value.to_owned();
        } else {
            styles.push((name, value.to_owned()));
        }
        self.set("style", AttrValue::Style(styles));
    }
    /// Remove a CSS property, retaining the other entries' order.
    pub fn style_remove_property(&mut self, name: &str) {
        let name = crate::css::uhyphen(name);
        let mut styles = self.styles();
        styles.retain(|(key, _)| key != &name);
        self.set("style", AttrValue::Style(styles));
    }
    /// Replace the children with text, or no children when empty.
    pub fn set_text_content(&mut self, text: &str) {
        self.children.clear();
        if !text.is_empty() {
            self.children.push(HtmlNode::Text(text.to_owned()));
        }
    }
    /// Append a node, splicing fragment children.
    pub fn append(&mut self, node: HtmlNode) {
        match node {
            HtmlNode::Fragment(children) => self.children.extend(children),
            node => self.children.push(node),
        }
    }
    /// Direct element children matching a case-insensitive tag.
    pub fn direct_children_mut<'e>(
        &'e mut self,
        tag: &'e str,
    ) -> impl Iterator<Item = &'e mut HtmlElement> + 'e {
        self.children.iter_mut().filter_map(move |node| match node {
            HtmlNode::Element(element) if element.tag.eq_ignore_ascii_case(tag) => Some(element),
            _ => None,
        })
    }
}
