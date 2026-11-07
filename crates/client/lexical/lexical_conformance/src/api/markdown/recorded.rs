//! Inline transformer objects retain their real matchers and taped replacements.
use super::*;
use lexical_markdown::{ExportCx, TextMatchTransformer, matcher::*};
use std::sync::Mutex;

pub(super) struct RecordedLink {
    owner: Arc<Mutex<Replayer>>,
    callback: Value,
    import: Option<RegexMatcher>,
    shortcut: RegexMatcher,
}
impl std::fmt::Debug for RecordedLink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecordedLink")
            .field("callback", &self.callback)
            .finish_non_exhaustive()
    }
}
impl RecordedLink {
    pub(super) fn decode(value: &Value, owner: Arc<Mutex<Replayer>>) -> Result<Self> {
        let object = value
            .as_object()
            .ok_or_else(|| fail("markdown transformer object"))?;
        if object.len() != 7
            || ![
                "dependencies",
                "export",
                "importRegExp",
                "regExp",
                "replace",
                "trigger",
                "type",
            ]
            .iter()
            .all(|key| object.contains_key(*key))
            || value["type"] != "text-match"
            || value["dependencies"] != json!([{"$klass":"link"}])
            || value["export"]
                != json!({"$fn":"@lexical/markdown/MarkdownTransformers.TRANSFORMERS.14.export"})
            || value["trigger"] != ")"
            || value["replace"].as_object().is_none_or(|o| o.len() != 1)
        {
            return Err(fail("unsupported inline markdown transformer"));
        }
        let id = integer(&value["replace"]["$tape"])? as usize;
        if owner
            .lock()
            .map_err(|_| fail("markdown callback lock"))?
            .tapes
            .get(id)
            .is_none()
        {
            return Err(fail("unknown markdown replacement tape"));
        }
        let regex = |v: &Value| -> Result<RegexMatcher> {
            if v.as_object().is_none_or(|o| o.len() != 3) || v["lastIndex"] != 0 {
                return Err(fail("markdown matcher field set"));
            }
            RegexMatcher::new(string(&v["$regexp"])?, string(&v["flags"])?)
                .map_err(|e| fail(e.to_string()))
        };
        Ok(Self {
            owner,
            callback: value["replace"].clone(),
            import: if value["importRegExp"].is_null() {
                None
            } else {
                Some(regex(&value["importRegExp"])?)
            },
            shortcut: regex(&value["regExp"])?,
        })
    }
}
impl TextMatchTransformer for RecordedLink {
    fn dependencies(&self) -> &[&'static str] {
        &["link"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &self.shortcut
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        self.import.as_ref().map(|m| m as &dyn Matcher)
    }
    fn trigger(&self) -> Option<char> {
        Some(')')
    }
    fn export(
        &self,
        cx: &mut ExportCx<'_>,
        node: NodeKey,
    ) -> lexical_markdown::Result<Option<String>> {
        Link.export(cx, node)
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> lexical_markdown::Result<Option<NodeKey>> {
        let mut invoke = || -> Result<Option<NodeKey>> {
            let mut r = self
                .owner
                .lock()
                .map_err(|_| fail("markdown callback lock"))?;
            let argument = r.node(tx.view(), node)?;
            let groups = (0..m.group_count())
                .map(|i| m.get(i).map_or_else(undefined, |s| json!(s)))
                .collect::<Vec<_>>();
            let ret = r.invoke_tape(tx, &self.callback, &[argument, json!(groups)])?;
            if ret.is_null() || ret.get("$undef").is_some() {
                Ok(None)
            } else {
                node_key(&ret).map(Some)
            }
        };
        invoke().map_err(|e| lexical_model::Error::invariant(e.to_string()).into())
    }
}

pub(super) fn with_registry<T>(
    r: &mut Replayer,
    value: Option<&Value>,
    f: impl FnOnce(&Transformers) -> Result<T>,
) -> Result<T> {
    let owner = Arc::new(Mutex::new(std::mem::take(r)));
    let result = registry(value, &owner).and_then(|registry| f(&registry));
    *r = std::mem::take(&mut *owner.lock().map_err(|_| fail("markdown callback lock"))?);
    result
}
