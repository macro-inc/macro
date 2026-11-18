//! GitHub `<details><summary>…</summary>…</details>` sections, nested to any depth, as
//! Source `transformers/details.ts`. The summary and body import with the transformer set
//! the section belongs to, filtered to the nodes the editor registered.
use super::*;
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;

const DETAILS_TAG: &str = r"<(\/?)details(?:\s[^>]*)?>";
const SUMMARY: &str = r"^\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>";
const OPEN_ATTRIBUTE: &str = r"(?:^|\s)open(?:\s|=|$)";
const FENCE: &str = r"^ {0,3}(`{3,}|~{3,})";
/// Source labels a section without a summary as GitHub does.
const DEFAULT_SUMMARY: &str = "Details";

/// Which transformer set a details transformer was built over.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum DetailsSet {
    /// One of the `internal`, `external` or `all` source lists.
    List(&'static str),
    /// The HTML blockquote set (`QUOTED_DETAILS`).
    Quoted,
}
impl DetailsSet {
    pub(super) fn of(name: &str) -> Option<Self> {
        Some(Self::List(match name {
            "DETAILS_INTERNAL" => "internal",
            "DETAILS_EXTERNAL" => "external",
            "DETAILS_ALL" => "all",
            _ => return None,
        }))
    }
    /// Each nested section filters the same set; build it once per thread and host option.
    fn transformers(self, options: &MacroMarkdownOptions) -> Result<Vec<Transformer>> {
        let key = (self, options.app_hostname.clone());
        if let Some(cached) = SETS.with(|sets| sets.borrow().get(&key).cloned()) {
            return Ok(cached);
        }
        let built = self.build(options)?;
        SETS.with(|sets| sets.borrow_mut().insert(key, built.clone()));
        Ok(built)
    }
    fn build(self, options: &MacroMarkdownOptions) -> Result<Vec<Transformer>> {
        match self {
            Self::List(list) => list_names(list)
                .ok_or(Error::InvalidArgument("unknown Macro transformer list"))?
                .iter()
                .map(|name| transformer(name, options))
                .collect(),
            Self::Quoted => super::quote::html_transformers(options),
        }
    }
    /// Source `$editorTransformers`: text formats declare no dependencies.
    fn registered(
        self,
        has_node: impl Fn(&str) -> bool,
        options: &MacroMarkdownOptions,
    ) -> Result<Transformers> {
        Ok(Transformers::new(
            self.transformers(options)?
                .into_iter()
                .filter(|transformer| dependencies(transformer).iter().all(|name| has_node(name))),
        ))
    }
}
fn dependencies(transformer: &Transformer) -> &[&'static str] {
    match transformer {
        Transformer::Element(callback) => callback.dependencies(),
        Transformer::MultilineElement(callback) => callback.dependencies(),
        Transformer::TextMatch(callback) => callback.dependencies(),
        Transformer::TextFormat(_) => &[],
    }
}
fn slice(text: &str, start: usize, end: usize) -> Result<String> {
    let units: Vec<u16> = text.encode_utf16().collect();
    units
        .get(start..end)
        .map(String::from_utf16_lossy)
        .ok_or(Error::InvalidArgument("invalid details match offset"))
}
/// A line's text up to the `</details>` that closes the outermost section.
fn consume_line(
    tags: &RegexMatcher,
    line: &str,
    starting_depth: i32,
) -> Result<(bool, i32, String)> {
    let mut depth = starting_depth;
    for m in tags.find_all(line) {
        depth += if m.get(1) == Some("/") { -1 } else { 1 };
        if depth == 0 {
            return Ok((true, depth, slice(line, 0, m.index.get() as usize)?));
        }
    }
    Ok((false, depth, line.into()))
}
#[expect(
    clippy::too_many_arguments,
    reason = "Forward the upstream multiline callback, its set and explicit host options"
)]
pub(super) fn after_start(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    lines: &[String],
    root: NodeKey,
    index: usize,
    start: &Match,
    set: DetailsSet,
    options: &MacroMarkdownOptions,
) -> Result<AfterStartMatch> {
    // Callers that don't filter transformers by node leave `<details>` as text.
    if !tx.view().has_node_type(DetailsNode::TYPE) {
        return Ok(AfterStartMatch::Skip);
    }
    let fence_pattern = RegexMatcher::new(FENCE, "")?;
    let tags = RegexMatcher::new(DETAILS_TAG, "i")?;
    let mut depth = 1;
    let mut fence: Option<String> = None;
    let mut content = Vec::new();
    for (line_index, line) in lines.iter().enumerate().skip(index) {
        let line = if line_index == index {
            start.get(2).unwrap_or("")
        } else {
            line
        };
        // Tags quoted in fenced code don't open or close a section.
        let marker = fence_pattern
            .exec(line)
            .and_then(|m| m.get(1).map(str::to_owned));
        if let Some(open) = &fence {
            if marker
                .as_deref()
                .is_some_and(|marker| marker.starts_with(open.as_str()))
            {
                fence = None;
            }
            content.push(line.to_owned());
            continue;
        }
        if marker.is_some() {
            fence = marker;
            content.push(line.to_owned());
            continue;
        }
        let (closed, next, text) = consume_line(&tags, line, depth)?;
        depth = next;
        content.push(text);
        if closed {
            let transformers = set.registered(|name| tx.view().has_node_type(name), options)?;
            let details = create(
                tx,
                opts,
                start.get(1).unwrap_or(""),
                &content.join("\n"),
                &transformers,
            )?;
            tx.append(root, &[details])?;
            return Ok(AfterStartMatch::Done {
                imported: true,
                last_line: line_index,
            });
        }
    }
    // Unclosed: leave the lines to the other transformers.
    Ok(AfterStartMatch::Skip)
}
type SetKey = (DetailsSet, Option<Arc<str>>);
std::thread_local! {
    static SETS: std::cell::RefCell<std::collections::HashMap<SetKey, Vec<Transformer>>> =
        std::cell::RefCell::default();
}
fn create(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    attributes: &str,
    content: &str,
    transformers: &Transformers,
) -> Result<NodeKey> {
    let _nesting = super::nesting::NestingGuard::enter()?;
    let details = tx.create(DetailsNode {
        open: RegexMatcher::new(OPEN_ATTRIBUTE, "i")?
            .exec(attributes)
            .is_some(),
    })?;
    let summary = tx.create(DetailsSummaryNode {})?;
    tx.append(details.key(), &[summary.key()])?;
    let summary_match = RegexMatcher::new(SUMMARY, "i")?.exec(content);
    let summary_markdown = summary_match
        .as_ref()
        .and_then(|m| m.get(1))
        .map(js_trim)
        .unwrap_or("");
    let body = match &summary_match {
        Some(m) => slice(
            content,
            m.full_len16() as usize,
            content.encode_utf16().count(),
        )?,
        None => content.into(),
    };
    let summary_markdown = if summary_markdown.is_empty() {
        DEFAULT_SUMMARY
    } else {
        summary_markdown
    };
    convert_from_markdown_string(
        tx,
        summary_markdown,
        transformers,
        Some(summary.key()),
        opts,
    )?;
    unwrap_single_paragraph(tx, summary.key())?;
    let body = js_trim(&body);
    if !body.is_empty() {
        let holder = tx.create(DetailsSummaryNode {})?;
        convert_from_markdown_string(tx, body, transformers, Some(holder.key()), opts)?;
        let children = tx.view().children_keys(holder.key())?;
        tx.append(details.key(), &children)?;
    }
    Ok(details.key())
}
/// Moves a lone paragraph's children up so the summary reads as one line.
fn unwrap_single_paragraph(tx: &mut Transaction<'_>, node: NodeKey) -> Result<()> {
    let children = tx.view().children_keys(node)?;
    let [paragraph] = children.as_slice() else {
        return Ok(());
    };
    if !tx.view().is::<Paragraph>(*paragraph) {
        return Ok(());
    }
    let grandchildren = tx.view().children_keys(*paragraph)?;
    tx.append(node, &grandchildren)?;
    tx.remove(*paragraph, false)?;
    Ok(())
}
pub(super) fn export(
    cx: &mut ExportCx<'_>,
    node: NodeKey,
    set: DetailsSet,
    options: &MacroMarkdownOptions,
) -> Result<Option<String>> {
    let Some(details) = cx.state().get::<DetailsNode>(node) else {
        return Ok(None);
    };
    let open = if details.open { " open" } else { "" };
    let summary = match cx.state().first_child(node) {
        Some(first) if cx.state().is::<DetailsSummaryNode>(first) => cx.export_children(first)?,
        _ => String::new(),
    };
    let state = cx.state();
    let transformers = set.registered(|name| state.has_node_type(name), options)?;
    // The body export starts with the summary, a block without its own transformer
    // that exports as its text.
    let body = convert_to_markdown_string(&state, &transformers, Some(node), cx.options())?;
    let body = match body.strip_prefix(summary.as_str()) {
        Some(rest) if !summary.is_empty() => rest,
        _ => body.as_str(),
    };
    Ok(Some(format!(
        "<details{open}>\n<summary>{summary}</summary>\n\n{}\n\n</details>",
        js_trim(body)
    )))
}
/// Source `QUOTED_DETAILS`: the details transformer over the HTML blockquote set.
#[derive(Debug)]
pub(super) struct QuotedDetails {
    // Same matchers and dependencies as the listed details transformers.
    inner: Arc<dyn MultilineElementTransformer>,
    options: MacroMarkdownOptions,
}
impl QuotedDetails {
    pub(super) fn new(options: &MacroMarkdownOptions) -> Result<Self> {
        let Transformer::MultilineElement(inner) = transformer("DETAILS_ALL", options)? else {
            return Err(Error::InvalidArgument("details transformer kind"));
        };
        Ok(Self {
            inner,
            options: options.clone(),
        })
    }
}
impl MultilineElementTransformer for QuotedDetails {
    fn dependencies(&self) -> &[&'static str] {
        self.inner.dependencies()
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        export(cx, node, DetailsSet::Quoted, &self.options)
    }
    fn handle_import_after_start_match(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        lines: &[String],
        root: NodeKey,
        index: usize,
        start: &Match,
    ) -> Result<AfterStartMatch> {
        after_start(
            tx,
            opts,
            lines,
            root,
            index,
            start,
            DetailsSet::Quoted,
            &self.options,
        )
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        self.inner.reg_exp_start()
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        self.inner.reg_exp_end()
    }
    fn replace(
        &self,
        _: &mut Transaction<'_>,
        _: &MarkdownOptions,
        _: NodeKey,
        _: Option<&[NodeKey]>,
        _: &Match,
        _: Option<&Match>,
        _: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        // Source `replace: () => false`: never a typing shortcut.
        Ok(ReplaceResult::NotHandled)
    }
}
