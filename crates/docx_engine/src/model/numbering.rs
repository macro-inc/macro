//! List numbering (`word/numbering.xml`): definitions, counters and labels.

mod format;

use super::props::{Align, PPr, RPr, ThemeInfo};
use super::styles::Styles;
use crate::xml::{NodeId, Ns, XmlTree, parse_int, parse_on_off};
pub use format::{NumFmt, format_number};
use std::collections::HashMap;

/// What follows a list label.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Suffix {
    /// A tab to the next stop.
    #[default]
    Tab,
    /// A space.
    Space,
    /// Nothing.
    Nothing,
}

/// One level of a list definition.
#[derive(Clone, Debug, PartialEq)]
pub struct Level {
    /// Start value.
    pub start: i64,
    /// Number format.
    pub fmt: NumFmt,
    /// Label template (`%1.`), `None` when absent.
    pub text: Option<String>,
    /// Label alignment.
    pub jc: Align,
    /// What follows the label.
    pub suffix: Suffix,
    /// Show every level as decimal (legal numbering).
    pub is_legal: bool,
    /// Restart after this level (0-based); `None` = after any higher level,
    /// `Some(-1)` = never.
    pub restart: Option<i64>,
    /// Paragraph properties (indents, tabs).
    pub ppr: PPr,
    /// Label run properties.
    pub rpr: RPr,
    /// Paragraph style linked to the level.
    pub style: Option<String>,
}

impl Default for Level {
    fn default() -> Self {
        Self {
            start: 1,
            fmt: NumFmt::Decimal,
            text: None,
            jc: Align::Left,
            suffix: Suffix::Tab,
            is_legal: false,
            restart: None,
            ppr: PPr::default(),
            rpr: RPr::default(),
            style: None,
        }
    }
}

/// An abstract list definition.
#[derive(Clone, Debug, Default)]
pub struct AbstractNum {
    /// Levels 0-8.
    pub levels: Vec<Option<Level>>,
    /// A numbering style whose definition this one uses instead.
    pub num_style_link: Option<String>,
}

/// A level override of a list instance.
#[derive(Clone, Debug, Default)]
pub struct LevelOverride {
    /// Restart value.
    pub start: Option<i64>,
    /// Replacement level definition.
    pub level: Option<Level>,
}

/// A list instance (`w:num`).
#[derive(Clone, Debug, Default)]
pub struct Num {
    /// The definition it instantiates.
    pub abstract_id: i64,
    /// Per-level overrides.
    pub overrides: HashMap<u8, LevelOverride>,
}

/// The numbering part.
#[derive(Clone, Debug, Default)]
pub struct Numbering {
    abstracts: HashMap<i64, AbstractNum>,
    nums: HashMap<i64, Num>,
}

fn read_level(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Level {
    let mut l = Level::default();
    for c in t.children(n) {
        if t.ns(c) != Ns::W {
            continue;
        }
        match t.local(c) {
            "start" => l.start = t.val(c).and_then(parse_int).unwrap_or(1),
            "numFmt" => {
                l.fmt = NumFmt::parse(t.val(c).unwrap_or("decimal"), t.w_attr(c, "format"));
            }
            "lvlText" => l.text = Some(t.val(c).unwrap_or("").to_owned()),
            "lvlJc" => {
                l.jc = match t.val(c) {
                    Some("center") => Align::Center,
                    Some("right" | "end") => Align::Right,
                    _ => Align::Left,
                }
            }
            "suff" => {
                l.suffix = match t.val(c) {
                    Some("space") => Suffix::Space,
                    Some("nothing") => Suffix::Nothing,
                    _ => Suffix::Tab,
                }
            }
            "isLgl" => l.is_legal = parse_on_off(t.val(c)),
            "lvlRestart" => {
                l.restart = t.val(c).and_then(parse_int).map(|v| v - 1);
            }
            "pPr" => l.ppr = PPr::read(t, c, theme),
            "rPr" => l.rpr = RPr::read(t, c, theme),
            "pStyle" => l.style = t.val(c).map(str::to_owned),
            _ => {}
        }
    }
    l
}

impl Numbering {
    /// Parses `numbering.xml`.
    pub fn parse(t: &XmlTree, theme: &ThemeInfo) -> Self {
        let root = t.root();
        let mut n = Numbering::default();
        for a in t.children_named(root, Ns::W, "abstractNum") {
            let Some(id) = t.w_attr(a, "abstractNumId").and_then(parse_int) else {
                continue;
            };
            let mut def = AbstractNum {
                levels: vec![None; 9],
                num_style_link: t.child_val(a, "numStyleLink").map(str::to_owned),
            };
            for lvl in t.children_named(a, Ns::W, "lvl") {
                let i = t.w_attr(lvl, "ilvl").and_then(parse_int).unwrap_or(0);
                if (0..9).contains(&i) {
                    def.levels[i as usize] = Some(read_level(t, lvl, theme));
                }
            }
            n.abstracts.insert(id, def);
        }
        for num in t.children_named(root, Ns::W, "num") {
            let Some(id) = t.w_attr(num, "numId").and_then(parse_int) else {
                continue;
            };
            let mut inst = Num {
                abstract_id: t
                    .child_val(num, "abstractNumId")
                    .and_then(parse_int)
                    .unwrap_or(-1),
                overrides: HashMap::new(),
            };
            for o in t.children_named(num, Ns::W, "lvlOverride") {
                let i = t.w_attr(o, "ilvl").and_then(parse_int).unwrap_or(0);
                if !(0..9).contains(&i) {
                    continue;
                }
                let mut lo = LevelOverride::default();
                if let Some(s) = t.child_val(o, "startOverride").and_then(parse_int) {
                    lo.start = Some(s);
                }
                if let Some(lvl) = t.w_child(o, "lvl") {
                    lo.level = Some(read_level(t, lvl, theme));
                }
                inst.overrides.insert(i as u8, lo);
            }
            n.nums.insert(id, inst);
        }
        n
    }

    /// Ids of every list instance.
    pub fn num_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.nums.keys().copied()
    }

    /// Ids of every abstract definition.
    pub fn abstract_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.abstracts.keys().copied()
    }

    /// The abstract definition a list instance names directly.
    pub fn abstract_of(&self, num_id: i64) -> Option<i64> {
        self.nums.get(&num_id).map(|n| n.abstract_id)
    }

    /// An abstract definition.
    pub fn abstract_num(&self, id: i64) -> Option<&AbstractNum> {
        self.abstracts.get(&id)
    }

    /// Whether the instance exists.
    pub fn has_num(&self, num_id: i64) -> bool {
        self.nums.contains_key(&num_id)
    }

    /// The abstract definition behind a list instance, following numbering
    /// style links.
    fn abstract_for(&self, num_id: i64, styles: &Styles) -> Option<(i64, &AbstractNum)> {
        let num = self.nums.get(&num_id)?;
        let mut id = num.abstract_id;
        for _ in 0..4 {
            let a = self.abstracts.get(&id)?;
            let Some(link) = &a.num_style_link else {
                return Some((id, a));
            };
            // The numbering style names a list instance in its paragraph properties.
            let linked = styles
                .get(link)
                .and_then(|s| s.ppr.num.num_id)
                .and_then(|n| self.nums.get(&n))
                .map(|n| n.abstract_id);
            match linked {
                Some(next) if next != id => id = next,
                _ => return Some((id, a)),
            }
        }
        None
    }

    /// The effective level definition of a list instance.
    pub fn level(&self, num_id: i64, ilvl: u8, styles: &Styles) -> Option<&Level> {
        let num = self.nums.get(&num_id)?;
        if let Some(l) = num.overrides.get(&ilvl).and_then(|o| o.level.as_ref()) {
            return Some(l);
        }
        let (_, a) = self.abstract_for(num_id, styles)?;
        a.levels.get(usize::from(ilvl)).and_then(Option::as_ref)
    }

    /// Paragraph properties a list level contributes.
    pub fn level_ppr(&self, num_id: i64, ilvl: u8, styles: &Styles) -> Option<PPr> {
        self.level(num_id, ilvl, styles).map(|l| l.ppr.clone())
    }
}

/// A computed list label.
#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    /// The label text.
    pub text: String,
    /// What follows it.
    pub suffix: Suffix,
    /// Alignment of the label at its position.
    pub jc: Align,
    /// Label run properties (overlaid on the paragraph mark's).
    pub rpr: RPr,
}

/// Running list counters, advanced paragraph by paragraph in document order.
#[derive(Clone, Debug, Default)]
pub struct Counters {
    /// Counter values per list (abstract id, or instance id when it overrides
    /// a start value) and level; `None` = not used yet.
    values: HashMap<ListKey, [Option<i64>; 9]>,
    /// Instances whose start overrides have been applied, per level.
    started: HashMap<i64, [bool; 9]>,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum ListKey {
    Abstract(i64),
    Instance(i64),
}

impl Counters {
    /// Advances the counters for a numbered paragraph and returns its label.
    pub fn next(
        &mut self,
        numbering: &Numbering,
        styles: &Styles,
        num_id: i64,
        ilvl: u8,
    ) -> Option<Label> {
        let num = numbering.nums.get(&num_id)?;
        let (abs_id, _) = numbering.abstract_for(num_id, styles)?;
        let level = numbering.level(num_id, ilvl, styles)?;
        let overrides_start = num
            .overrides
            .values()
            .any(|o| o.start.is_some() || o.level.is_some());
        let key = if overrides_start {
            ListKey::Instance(num_id)
        } else {
            ListKey::Abstract(abs_id)
        };
        let started = self.started.entry(num_id).or_insert([false; 9]);
        let override_start = num.overrides.get(&ilvl).and_then(|o| o.start);
        let restart_with = if !started[usize::from(ilvl)] {
            started[usize::from(ilvl)] = true;
            override_start
        } else {
            None
        };
        let values = self.values.entry(key).or_insert([None; 9]);
        let i = usize::from(ilvl);
        values[i] = Some(match (restart_with, values[i]) {
            (Some(s), _) => s,
            (None, Some(v)) => v + 1,
            (None, None) => level.start,
        });
        // Deeper levels restart after this one (unless told otherwise).
        for d in i + 1..9 {
            let deeper = numbering.level(num_id, d as u8, styles);
            let restarts = match deeper.as_ref().and_then(|l| l.restart) {
                None => true,
                Some(r) if r < 0 => false,
                Some(r) => (i as i64) <= r,
            };
            if restarts {
                values[d] = None;
            }
        }
        let snapshot = *values;
        let template = level.text.as_deref().unwrap_or_default();
        let mut text = String::new();
        let mut chars = template.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '%'
                && let Some(&d) = chars.peek()
                && let Some(n) = d.to_digit(10)
                && (1..=9).contains(&n)
            {
                chars.next();
                let li = (n - 1) as usize;
                let lv = if li == i {
                    Some(level)
                } else {
                    numbering.level(num_id, li as u8, styles)
                };
                let value = snapshot[li].unwrap_or_else(|| lv.map_or(1, |l| l.start));
                let own = lv.map_or(NumFmt::Decimal, |l| l.fmt.clone());
                // Legal numbering shows every level's number as decimal.
                let fmt = if level.is_legal && !matches!(own, NumFmt::Bullet | NumFmt::None) {
                    NumFmt::Decimal
                } else {
                    own
                };
                text.push_str(&format_number(value, &fmt));
            } else {
                text.push(c);
            }
        }
        if level.fmt == NumFmt::Bullet && level.text.is_none() {
            text.push('\u{2022}');
        }
        Some(Label {
            text,
            suffix: level.suffix,
            jc: level.jc,
            rpr: level.rpr.clone(),
        })
    }
}

#[cfg(test)]
mod test;
