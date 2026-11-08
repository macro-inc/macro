//! Intermediate representation for a regex

use crate::api;
use crate::types::{BracketContents, CaptureGroupID, CaptureGroupName};
#[cfg(not(feature = "std"))]
use alloc::{boxed::Box, vec::Vec};
use core::fmt;

#[derive(Debug, Copy, Clone)]
pub enum AnchorType {
    StartOfLine, // ^
    EndOfLine,   // $
}

/// A Quantifier.
#[derive(Debug, Copy, Clone)]
pub struct Quantifier {
    /// Minimum number of iterations of the loop, inclusive.
    pub min: usize,

    /// Maximum number of iterations of the loop, inclusive;
    /// or None if unbounded.
    pub max: Option<usize>,

    /// Whether the loop is greedy.
    pub greedy: bool,
}

/// The node types of our IR.
#[derive(Debug, Clone)]
pub enum Node {
    /// Matches the empty string.
    Empty,

    /// Reaching this node terminates the match successfully.
    Goal,

    /// Match a literal character.
    Char { c: u32 },

    /// Match a literal sequence of bytes.
    ByteSequence(Vec<u8>),

    /// Match any of a set of *bytes*.
    /// This may not exceed length MAX_CHAR_SET_LENGTH.
    ByteSet(Vec<u8>),

    /// Match any of a set of *chars*.
    /// This may not exceed length MAX_CHAR_SET_LENGTH.
    CharSet(Vec<u32>),

    /// Match the catenation of multiple nodes.
    Cat(Vec<Node>),

    /// Match an alternation like a|b.
    Alt(Box<Node>, Box<Node>),

    /// Match anything including newlines.
    MatchAny,

    /// Match anything except a newline.
    MatchAnyExceptLineTerminator,

    /// Match an anchor like ^ or $. The `multiline` flag controls whether the
    /// anchor should treat line terminators as boundaries.
    Anchor {
        anchor_type: AnchorType,
        multiline: bool,
    },

    /// Word boundary (\b or \B).
    WordBoundary { invert: bool, unicode_icase: bool },

    /// A capturing group.
    /// If the name is set, it is guaranteed nonempty.
    /// Note that multiple capture groups may share the same name in different alternations.
    CaptureGroup {
        id: CaptureGroupID,
        contents: Box<Node>,
        name: Option<CaptureGroupName>,
    },

    /// A backreference.
    /// Indices are 1-based. That is, it matches JS syntax: \1 is the first capture group,
    /// not everything.
    /// A backreference that logically may match multiple capture groups (through shared names)
    /// are emitted through alternations of backreferences.
    BackRef { group: u32, icase: bool },

    /// A bracket.
    Bracket(BracketContents),

    /// A priority ordered list of alternative strings, each as a sequence of code points,
    /// and whether case-insensitive matching is enabled.
    StringSet {
        alternatives: Vec<Box<[u32]>>,
        icase: bool,
    },

    /// A lookaround assertions like (?=...) or (?!...).
    LookaroundAssertion {
        negate: bool,
        backwards: bool,
        start_group: CaptureGroupID,
        end_group: CaptureGroupID,
        contents: Box<Node>,
    },

    /// A loop like /.*/ or /x{3, 5}?/
    Loop {
        loopee: Box<Node>,
        quant: Quantifier,
        enclosed_groups: core::ops::Range<u16>,
    },

    /// A loop whose body matches exactly one character.
    /// Enclosed capture groups are forbidden here.
    Loop1CharBody {
        loopee: Box<Node>,
        quant: Quantifier,
    },
}

pub type NodeList = Vec<Node>;

impl Node {
    /// Helper to return an "always fails" node.
    pub fn make_always_fails() -> Node {
        Node::CharSet(Vec::new())
    }

    /// Reverse the children of \p self if in a lookbehind.
    /// Used as a parameter to walk_mut.
    pub fn reverse_cats(&mut self, w: &mut Walk) {
        match self {
            Node::Cat(nodes) if w.in_lookbehind => nodes.reverse(),
            Node::ByteSequence(..) => panic!("Should not be reversing literal bytes"),
            _ => {}
        }
    }

    /// \return whether this is an Empty node.
    pub fn is_empty(&self) -> bool {
        matches!(self, Node::Empty)
    }

    /// \return whether this is a Cat node.
    pub fn is_cat(&self) -> bool {
        matches!(self, Node::Cat(..))
    }

    /// \return whether this node is known to match exactly one char.
    /// This is best-effort: a false return is always safe.
    pub fn matches_exactly_one_char(&self) -> bool {
        match self {
            Node::Char { .. } => true,
            Node::CharSet(contents) => !contents.is_empty(),
            Node::Bracket(contents) => !contents.is_empty(),
            Node::MatchAny => true,
            Node::MatchAnyExceptLineTerminator => true,
            _ => false,
        }
    }

    /// \return true if this node will always fail to match.
    /// Note this is different than matching the empty string.
    /// For example, an empty bracket /[]/ tries to match one char
    /// from an empty set.
    pub fn match_always_fails(&self) -> bool {
        match self {
            Node::ByteSet(bytes) => bytes.is_empty(),
            Node::CharSet(contents) => contents.is_empty(),
            Node::Bracket(contents) => contents.is_empty(),
            _ => false,
        }
    }

    /// Duplicate a node, perhaps assigning new loop IDs. Note we must never
    /// copy a capture group.
    ///
    /// Returns None if the depth is too high.
    pub fn try_duplicate(&self, mut depth: usize) -> Option<Node> {
        if depth > 100 {
            return None;
        }
        depth += 1;
        Some(match self {
            Node::Empty => Node::Empty,
            Node::Goal => Node::Goal,
            &Node::Char { c } => Node::Char { c },
            Node::ByteSequence(bytes) => Node::ByteSequence(bytes.clone()),
            Node::ByteSet(bytes) => Node::ByteSet(bytes.clone()),
            Node::CharSet(chars) => Node::CharSet(chars.clone()),
            // string sets are often extremely large - don't try unrolling.
            Node::StringSet { .. } => return None,
            Node::Cat(nodes) => {
                let mut new_nodes = Vec::with_capacity(nodes.len());
                for n in nodes {
                    new_nodes.push(n.try_duplicate(depth)?);
                }
                Node::Cat(new_nodes)
            }
            Node::Alt(left, right) => Node::Alt(
                Box::new(left.try_duplicate(depth)?),
                Box::new(right.try_duplicate(depth)?),
            ),
            Node::MatchAny => Node::MatchAny,
            Node::MatchAnyExceptLineTerminator => Node::MatchAnyExceptLineTerminator,
            &Node::Anchor {
                anchor_type,
                multiline,
            } => Node::Anchor {
                anchor_type,
                multiline,
            },

            Node::Loop {
                loopee,
                quant,
                enclosed_groups,
            } => {
                assert!(
                    enclosed_groups.start >= enclosed_groups.end,
                    "Cannot duplicate a loop with enclosed groups"
                );
                Node::Loop {
                    loopee: Box::new(loopee.as_ref().try_duplicate(depth)?),
                    quant: *quant,
                    enclosed_groups: enclosed_groups.clone(),
                }
            }

            Node::Loop1CharBody { loopee, quant } => Node::Loop1CharBody {
                loopee: Box::new(loopee.as_ref().try_duplicate(depth)?),
                quant: *quant,
            },

            Node::CaptureGroup { .. } => {
                panic!("Refusing to duplicate a capture group");
            }
            &Node::WordBoundary {
                invert,
                unicode_icase,
            } => Node::WordBoundary {
                invert,
                unicode_icase,
            },
            &Node::BackRef { group, icase } => Node::BackRef { group, icase },
            Node::Bracket(bc) => Node::Bracket(bc.clone()),
            // Do not reverse into lookarounds, they already have the right sense.
            Node::LookaroundAssertion {
                negate,
                backwards,
                start_group,
                end_group,
                contents,
            } => {
                assert!(
                    start_group >= end_group,
                    "Cannot duplicate an assertion with enclosed groups"
                );
                Node::LookaroundAssertion {
                    negate: *negate,
                    backwards: *backwards,
                    start_group: *start_group,
                    end_group: *end_group,
                    contents: Box::new((*contents).try_duplicate(depth)?),
                }
            }
        })
    }
}

/// A helper type for walking.
#[derive(Debug, Clone)]
pub struct Walk {
    // It set to true, skip the children of this node.
    pub skip_children: bool,

    // The current depth of the walk.
    pub depth: usize,

    // If true, we are in a lookbehind (and so the cursor will move backwards).
    pub in_lookbehind: bool,

    // If the regex is in unicode mode.
    pub unicode: bool,
}

impl Walk {
    fn new(unicode: bool) -> Self {
        Self {
            skip_children: false,
            depth: 0,
            in_lookbehind: false,
            unicode,
        }
    }
}

#[derive(Debug)]
struct Walker<'a, F>
where
    F: FnMut(&Node, &mut Walk),
{
    func: &'a mut F,
    postorder: bool,
    walk: Walk,
}

impl<F> Walker<'_, F>
where
    F: FnMut(&Node, &mut Walk),
{
    fn process_children(&mut self, n: &Node) {
        match n {
            Node::Empty
            | Node::Goal
            | Node::Char { .. }
            | Node::ByteSequence(..)
            | Node::ByteSet(..)
            | Node::CharSet(..)
            | Node::StringSet { .. }
            | Node::WordBoundary { .. }
            | Node::BackRef { .. }
            | Node::Bracket { .. }
            | Node::MatchAny
            | Node::MatchAnyExceptLineTerminator
            | Node::Anchor { .. } => {}
            Node::Cat(nodes) => {
                for node in nodes {
                    self.process(node);
                }
            }
            Node::Alt(left, right) => {
                self.process(left.as_ref());
                self.process(right.as_ref());
            }

            Node::Loop { loopee, .. } | Node::Loop1CharBody { loopee, .. } => self.process(loopee),
            Node::CaptureGroup { contents, .. } => self.process(contents.as_ref()),

            Node::LookaroundAssertion {
                backwards,
                contents,
                ..
            } => {
                let saved = self.walk.in_lookbehind;
                self.walk.in_lookbehind = *backwards;
                self.process(contents.as_ref());
                self.walk.in_lookbehind = saved;
            }
        }
    }

    fn process(&mut self, n: &Node) {
        self.walk.skip_children = false;
        if !self.postorder {
            (self.func)(n, &mut self.walk);
        }
        if !self.walk.skip_children {
            self.walk.depth += 1;
            self.process_children(n);
            self.walk.depth -= 1;
        }
        if self.postorder {
            (self.func)(n, &mut self.walk)
        }
    }
}

#[derive(Debug)]
struct MutWalker<'a, F>
where
    F: FnMut(&mut Node, &mut Walk),
{
    func: &'a mut F,
    postorder: bool,
    walk: Walk,
}

impl<F> MutWalker<'_, F>
where
    F: FnMut(&mut Node, &mut Walk),
{
    fn process_children(&mut self, n: &mut Node) {
        match n {
            Node::Empty
            | Node::Goal
            | Node::Char { .. }
            | Node::ByteSequence(..)
            | Node::ByteSet(..)
            | Node::CharSet(..)
            | Node::StringSet { .. }
            | Node::MatchAny
            | Node::MatchAnyExceptLineTerminator
            | Node::Anchor { .. }
            | Node::WordBoundary { .. }
            | Node::BackRef { .. }
            | Node::Bracket { .. } => {}
            Node::Cat(nodes) => {
                nodes.iter_mut().for_each(|node| self.process(node));
            }
            Node::Alt(left, right) => {
                self.process(left.as_mut());
                self.process(right.as_mut());
            }

            Node::Loop { loopee, .. } | Node::Loop1CharBody { loopee, .. } => {
                self.process(loopee);
            }
            Node::CaptureGroup { contents, .. } => self.process(contents.as_mut()),

            Node::LookaroundAssertion {
                backwards,
                contents,
                ..
            } => {
                let saved = self.walk.in_lookbehind;
                self.walk.in_lookbehind = *backwards;
                self.process(contents.as_mut());
                self.walk.in_lookbehind = saved;
            }
        }
    }

    fn process(&mut self, n: &mut Node) {
        self.walk.skip_children = false;
        if !self.postorder {
            (self.func)(n, &mut self.walk);
        }
        if !self.walk.skip_children {
            self.walk.depth += 1;
            self.process_children(n);
            self.walk.depth -= 1;
        }
        if self.postorder {
            (self.func)(n, &mut self.walk);
        }
    }
}

/// Call a function on every Node.
/// If \p postorder is true, then process children before the node;
/// otherwise process children after the node.
pub fn walk<F>(postorder: bool, unicode: bool, n: &Node, func: &mut F)
where
    F: FnMut(&Node, &mut Walk),
{
    let mut walker = Walker {
        func,
        postorder,
        walk: Walk::new(unicode),
    };
    walker.process(n);
}

/// Call a function on every Node, which may mutate the node.
/// If \p postorder is true, then process children before the node;
/// otherwise process children after the node.
/// If postorder is false, the function should return true to process children,
/// false to avoid descending into children. If postorder is true, the return
/// value is ignored.
pub fn walk_mut<F>(postorder: bool, unicode: bool, n: &mut Node, func: &mut F)
where
    F: FnMut(&mut Node, &mut Walk),
{
    let mut walker = MutWalker {
        func,
        postorder,
        walk: Walk::new(unicode),
    };
    walker.process(n);
}

/// A regex in IR form.
pub struct Regex {
    pub node: Node,
    pub flags: api::Flags,
}

impl Regex {}

fn display_node(node: &Node, depth: usize, f: &mut fmt::Formatter) -> fmt::Result {
    const MAX_DEPTH_DOTS: usize = 120;
    for _ in 0..depth.min(MAX_DEPTH_DOTS) {
        write!(f, "..")?;
    }
    if depth > MAX_DEPTH_DOTS {
        write!(f, "(+{}).. ", depth - MAX_DEPTH_DOTS)?;
    }
    match node {
        Node::Empty => {
            writeln!(f, "Empty")?;
        }
        Node::Goal => {
            writeln!(f, "Goal")?;
        }
        Node::Char { c } => {
            writeln!(f, "'{}'", c)?;
        }
        Node::ByteSequence(bytes) => {
            write!(f, "ByteSeq{} 0x", bytes.len())?;
            for &b in bytes {
                write!(f, "{:x}", b)?;
            }
            writeln!(f)?;
        }
        Node::ByteSet(bytes) => {
            let len = bytes.len();
            write!(f, "ByteSet{}", len)?;
            for &b in bytes {
                write!(f, " 0x{:x}", b)?;
            }
            writeln!(f)?;
        }
        Node::CharSet(chars) => {
            write!(f, "CharSet ")?;
            let mut first = true;
            for &c in chars {
                if !first {
                    write!(f, ", ")?;
                }
                first = false;
                write!(f, "0x{:x}", { c })?;
            }
            writeln!(f)?;
        }
        Node::StringSet {
            alternatives,
            icase,
        } => {
            writeln!(f, "StringSet count={}, icase={}", alternatives.len(), icase)?;
        }
        Node::Cat(..) => {
            writeln!(f, "Cat")?;
        }
        Node::Alt(..) => {
            writeln!(f, "Alt")?;
        }
        Node::MatchAny => {
            writeln!(f, "MatchAny")?;
        }
        Node::MatchAnyExceptLineTerminator => {
            writeln!(f, "MatchAnyExceptLineTerminator")?;
        }
        Node::Anchor {
            anchor_type,
            multiline,
        } => {
            writeln!(f, "Anchor {:?} multiline={}", anchor_type, multiline)?;
        }
        Node::Loop {
            quant,
            enclosed_groups,
            ..
        } => {
            writeln!(f, "Loop (groups {:?}) {:?}", enclosed_groups, quant)?;
        }
        Node::Loop1CharBody { quant, .. } => {
            writeln!(f, "Loop1Char {:?}", quant)?;
        }
        Node::CaptureGroup { id, name, .. } => {
            if let Some(name) = name {
                writeln!(f, "CaptureGroup {:?} {:?}", id, name)?;
            } else {
                writeln!(f, "CaptureGroup {:?}", id)?;
            }
        }
        &Node::WordBoundary { invert, .. } => {
            let kind = if invert { "\\B" } else { "\\b" };
            writeln!(f, "WordBoundary {:?} ", kind)?;
        }
        &Node::BackRef { group, .. } => {
            writeln!(f, "BackRef {:?} ", group)?;
        }
        Node::Bracket(contents) => {
            writeln!(f, "Bracket {:?}", contents)?;
        }

        &Node::LookaroundAssertion {
            negate,
            backwards,
            start_group,
            end_group,
            ..
        } => {
            let sense = if negate { "negative" } else { "positive" };
            let direction = if backwards { "backwards" } else { "forwards" };
            writeln!(
                f,
                "LookaroundAssertion {} {} {:?} {:?}",
                sense, direction, start_group, end_group
            )?;
        }
    }
    Ok(())
}

impl fmt::Display for Regex {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        //display_node(&self.node, 0, f)
        let mut result = Ok(());
        walk(
            false,
            self.flags.unicode,
            &self.node,
            &mut |node: &Node, walk: &mut Walk| {
                if result.is_ok() {
                    result = display_node(node, walk.depth, f)
                }
            },
        );
        result
    }
}
