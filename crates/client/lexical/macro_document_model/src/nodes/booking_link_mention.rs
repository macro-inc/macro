//! BookingLinkMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable BookingLinkMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingLinkMentionNode {
    /// Stored profile id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub profile_id: Maybe<String>,
    /// Stored slug payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub slug: Maybe<String>,
    /// Stored label payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub label: Maybe<String>,
    /// Stored url payload.
    pub url: String,
    /// Host captured when loading or constructing; never part of stored node identity.
    #[serde(skip)]
    pub host: Option<std::sync::Arc<str>>,
}
impl NodeType for BookingLinkMentionNode {
    const TYPE: &'static str = "booking-link-mention";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        if node.url.is_empty() {
            node.url = booking_url(&node);
        }
        Some(node)
    }
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        let host = tx
            .try_extension::<crate::NodeHost>()
            .and_then(|host| host.0.clone());
        let mut json = json.clone();
        let mut node = Self::import_json(&json)?;
        node.host = host.clone();
        if !json.get("url").is_some_and(js_truthy) {
            json.insert("url".into(), booking_url(&node).into());
        }
        let key = super::wire::import_node::<Self>(tx, &json)?;
        tx.get_mut::<Self>(key)?.host = host;
        Ok(key)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for BookingLinkMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for BookingLinkMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self
            .label
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(self.slug.as_deref().filter(|s| !s.is_empty()))
            .unwrap_or("Booking link")
            .to_owned())
        .into()
    }
}
impl SearchText for BookingLinkMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(
            self.label
                .as_deref()
                .filter(|s| !s.is_empty())
                .or(self.slug.as_deref().filter(|s| !s.is_empty()))
                .unwrap_or("Booking link")
                .into(),
        )
    }
}

impl PartialEq for BookingLinkMentionNode {
    fn eq(&self, other: &Self) -> bool {
        self.profile_id == other.profile_id
            && self.slug == other.slug
            && self.label == other.label
            && self.url == other.url
    }
}
fn component(value: &str) -> String {
    let mut encoded = urlencoding::encode(value).into_owned();
    for (escape, literal) in [
        ("%21", "!"),
        ("%27", "'"),
        ("%28", "("),
        ("%29", ")"),
        ("%2A", "*"),
    ] {
        encoded = encoded.replace(escape, literal);
    }
    encoded
}
fn booking_url(node: &BookingLinkMentionNode) -> String {
    let profile = js_optional(&node.profile_id);
    match node.host.as_deref() {
        Some(host) => {
            let clean = if host == "localhost" {
                "dev.macro.com".to_owned()
            } else {
                host.replacen("www.", "", 1)
            };
            let mut url = format!("https://{clean}/app/book/{}", component(profile));
            if let Some(slug) = node.slug.as_deref().filter(|s| !s.is_empty()) {
                url.push('/');
                url.push_str(&component(slug));
            }
            url
        }
        None => format!("https://macro.com/app/book/{profile}"),
    }
}
/// Create a booking mention using the editor's explicit hostname, when provided.
pub fn create_booking_link_mention_node(
    tx: &mut Transaction<'_>,
    mut node: BookingLinkMentionNode,
) -> crate::Result<Id<BookingLinkMentionNode>> {
    node.host = tx
        .try_extension::<crate::NodeHost>()
        .and_then(|host| host.0.clone());
    if node.url.is_empty() {
        node.url = booking_url(&node);
    }
    tx.create(node)
}
fn booking_pattern() -> &'static regress::Regex {
    static PATTERN: std::sync::LazyLock<regress::Regex> = std::sync::LazyLock::new(|| {
        regress::Regex::new(r"^https?://(?:www\.)?(?:macro\.com|localhost:\d+|dev\.macro\.com|staging\.macro\.com)/app/book/([^/?#]+)(?:/([^/?#]+))?(?:[?#].*)?$").expect("literal booking URL regex")
    });
    &PATTERN
}
/// Validate a booking URL without decoding its path components.
pub fn is_macro_booking_url(url: &str) -> bool {
    booking_pattern().find(url).is_some()
}
/// Decode the profile and optional slug; malformed escapes and UTF-8 fail.
pub fn parse_booking_url(url: &str) -> Option<(String, Option<String>)> {
    let found = booking_pattern().find(url)?;
    let decode = |value: &str| {
        static INVALID_ESCAPE: std::sync::LazyLock<regress::Regex> =
            std::sync::LazyLock::new(|| {
                regress::Regex::new(r"%(?![0-9A-Fa-f]{2})").expect("literal percent escape regex")
            });
        if INVALID_ESCAPE.find(value).is_some() {
            return None;
        }
        urlencoding::decode(value).ok().map(|s| s.into_owned())
    };
    let profile = decode(url.get(found.group(1)?)?)?;
    let slug = match found.group(2) {
        Some(range) => Some(decode(url.get(range)?)?),
        None => None,
    };
    Some((profile, slug))
}
