//! Document settings (`word/settings.xml`) that affect layout.

use super::numbering::NumFmt;
use crate::units::twips;
use crate::xml::{Ns, XmlTree, parse_int, parse_on_off};

/// Where notes are numbered from and how.
#[derive(Clone, Debug, PartialEq)]
pub struct NoteSettings {
    /// Number format.
    pub fmt: NumFmt,
    /// First number.
    pub start: i64,
    /// Restart numbering on each page or section.
    pub restart: NoteRestart,
}

/// When note numbering restarts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NoteRestart {
    /// Never.
    #[default]
    Continuous,
    /// Each section.
    EachSection,
    /// Each page.
    EachPage,
}

/// Layout-relevant settings.
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    /// Default tab stop interval (points).
    pub default_tab: f32,
    /// Different headers for even and odd pages.
    pub even_and_odd_headers: bool,
    /// Mirror margins on facing pages.
    pub mirror_margins: bool,
    /// Word compatibility mode (11 = 2003, 12 = 2007, 14 = 2010, 15 = 2013+).
    pub compat_mode: u32,
    /// Lines ending in a manual break in justified paragraphs are not stretched.
    pub do_not_expand_shift_return: bool,
    /// Space before is dropped after a manual page or column break.
    pub suppress_sp_bf_after_pg_brk: bool,
    /// Automatic hyphenation.
    pub auto_hyphenation: bool,
    /// Footnote numbering.
    pub footnotes: NoteSettings,
    /// Endnote numbering.
    pub endnotes: NoteSettings,
    /// Changes are being tracked.
    pub track_revisions: bool,
    /// Grow autospacing like HTML (`doNotUseHTMLParagraphAutoSpacing` off).
    pub html_auto_spacing: bool,
    /// The paragraph mark after a page break goes to the next page with the
    /// text after the break (`splitPgBreakAndParaMark`); otherwise it stays
    /// with the break.
    pub split_page_break_and_mark: bool,
    /// The first line on a page drops the extra room its at-least line
    /// spacing gives it (`suppressTopSpacing`).
    pub suppress_top_spacing: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_tab: 36.0,
            even_and_odd_headers: false,
            mirror_margins: false,
            compat_mode: 12,
            do_not_expand_shift_return: false,
            suppress_sp_bf_after_pg_brk: false,
            auto_hyphenation: false,
            footnotes: NoteSettings {
                fmt: NumFmt::Decimal,
                start: 1,
                restart: NoteRestart::Continuous,
            },
            endnotes: NoteSettings {
                fmt: NumFmt::LowerRoman,
                start: 1,
                restart: NoteRestart::Continuous,
            },
            track_revisions: false,
            html_auto_spacing: true,
            split_page_break_and_mark: false,
            suppress_top_spacing: false,
        }
    }
}

fn read_notes(t: &XmlTree, n: crate::xml::NodeId, into: &mut NoteSettings) {
    for c in t.children(n) {
        match t.local(c) {
            "numFmt" => into.fmt = NumFmt::parse(t.val(c).unwrap_or("decimal"), None),
            "numStart" => into.start = t.val(c).and_then(parse_int).unwrap_or(1),
            "numRestart" => {
                into.restart = match t.val(c) {
                    Some("eachSect") => NoteRestart::EachSection,
                    Some("eachPage") => NoteRestart::EachPage,
                    _ => NoteRestart::Continuous,
                }
            }
            _ => {}
        }
    }
}

impl Settings {
    /// Parses `settings.xml`.
    pub fn parse(t: &XmlTree) -> Self {
        let mut s = Settings::default();
        let root = t.root();
        for c in t.children(root) {
            if t.ns(c) != Ns::W {
                continue;
            }
            match t.local(c) {
                "defaultTabStop" => {
                    if let Some(v) = t.val(c).and_then(parse_int).filter(|v| *v > 0) {
                        s.default_tab = twips(v);
                    }
                }
                "evenAndOddHeaders" => s.even_and_odd_headers = parse_on_off(t.val(c)),
                "mirrorMargins" => s.mirror_margins = parse_on_off(t.val(c)),
                "autoHyphenation" => s.auto_hyphenation = parse_on_off(t.val(c)),
                "trackRevisions" => s.track_revisions = parse_on_off(t.val(c)),
                "footnotePr" => read_notes(t, c, &mut s.footnotes),
                "endnotePr" => read_notes(t, c, &mut s.endnotes),
                "compat" => {
                    for k in t.children(c) {
                        match t.local(k) {
                            "compatSetting" => {
                                if t.w_attr(k, "name") == Some("compatibilityMode") {
                                    s.compat_mode = t
                                        .w_attr(k, "val")
                                        .and_then(parse_int)
                                        .map_or(12, |v| v.clamp(11, 99) as u32);
                                }
                            }
                            "doNotExpandShiftReturn" => {
                                s.do_not_expand_shift_return = parse_on_off(t.val(k));
                            }
                            "suppressSpBfAfterPgBrk" => {
                                s.suppress_sp_bf_after_pg_brk = parse_on_off(t.val(k));
                            }
                            "doNotUseHTMLParagraphAutoSpacing" => {
                                s.html_auto_spacing = !parse_on_off(t.val(k));
                            }
                            "splitPgBreakAndParaMark" => {
                                s.split_page_break_and_mark = parse_on_off(t.val(k));
                            }
                            "suppressTopSpacing" => {
                                s.suppress_top_spacing = parse_on_off(t.val(k));
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        s
    }
}
