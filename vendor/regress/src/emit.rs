//! Regex compiler back-end: transforms IR into a CompiledRegex

use crate::bytesearch::{AsciiBitmap, ByteArraySet};
use crate::insn::{CompiledRegex, Insn, LoopFields, MAX_BYTE_SEQ_LENGTH, MAX_CHAR_SET_LENGTH};
use crate::ir;
use crate::ir::Node;
#[cfg(not(feature = "utf16"))]
use crate::literal::lower_code_point_sequence;
use crate::startpredicate;
use crate::types::{BracketContents, CaptureGroupID, LoopID};
#[cfg(feature = "utf16")]
use crate::unicode;
#[cfg(not(feature = "std"))]
use alloc::{boxed::Box, vec::Vec};
use core::convert::TryInto;

/// \return an anchor instruction for a given IR anchor.
fn make_anchor(anchor_type: ir::AnchorType, multiline: bool) -> Insn {
    match anchor_type {
        ir::AnchorType::StartOfLine => Insn::StartOfLine { multiline },
        ir::AnchorType::EndOfLine => Insn::EndOfLine { multiline },
    }
}

/// Weirdly placed optimization.
/// If the given bracket can be represented as ASCII contents, return the
/// bitmap. Otherwise nothing.
fn bracket_as_ascii(bc: &BracketContents) -> Option<AsciiBitmap> {
    let mut result = AsciiBitmap::default();
    // We just assume that inverted brackets contain non-ASCII characters.
    if bc.invert {
        return None;
    }
    for r in bc.cps.intervals() {
        debug_assert!(r.first <= r.last);
        if r.last >= 128 {
            return None;
        }
        for bit in r.first..=r.last {
            result.set(bit as u8)
        }
    }
    Some(result)
}

/// Type which wraps up the context needed to emit a CompiledRegex.
struct Emitter {
    result: CompiledRegex,

    // Number of loops seen so far.
    next_loop_id: LoopID,

    // List of group names, in order, with empties for unnamed groups.
    group_names: Vec<Box<str>>,

    // Whether the current node is within a lookbehind.
    in_lookbehind: bool,
}

impl Emitter {
    /// Emit a ByteSet instruction.
    /// We awkwardly optimize it like so.
    fn emit_byte_set_insn(&mut self, bytes: &[u8]) {
        let insn = match bytes.len() {
            0 => Insn::JustFail,
            1 => Insn::ByteSeq1(bytes.try_into().unwrap()),
            2 => Insn::ByteSet2(ByteArraySet(bytes.try_into().unwrap())),
            3 => Insn::ByteSet3(ByteArraySet(bytes.try_into().unwrap())),
            4 => Insn::ByteSet4(ByteArraySet(bytes.try_into().unwrap())),
            _ => panic!("Byte set is too long"),
        };
        self.emit_insn(insn);
    }

    // Emit a nonempty byte sequence instruction. The sequence must be at most MAX_BYTE_SEQ_LENGTH bytes.
    fn emit_byte_sequence_insn(&mut self, seq: &[u8]) {
        const {
            assert!(
                MAX_BYTE_SEQ_LENGTH == 16,
                "Need to update our emitting logic"
            );
        };
        let insn = match seq.len() {
            1 => Insn::ByteSeq1(seq.try_into().unwrap()),
            2 => Insn::ByteSeq2(seq.try_into().unwrap()),
            3 => Insn::ByteSeq3(seq.try_into().unwrap()),
            4 => Insn::ByteSeq4(seq.try_into().unwrap()),
            5 => Insn::ByteSeq5(seq.try_into().unwrap()),
            6 => Insn::ByteSeq6(seq.try_into().unwrap()),
            7 => Insn::ByteSeq7(seq.try_into().unwrap()),
            8 => Insn::ByteSeq8(seq.try_into().unwrap()),
            9 => Insn::ByteSeq9(seq.try_into().unwrap()),
            10 => Insn::ByteSeq10(seq.try_into().unwrap()),
            11 => Insn::ByteSeq11(seq.try_into().unwrap()),
            12 => Insn::ByteSeq12(seq.try_into().unwrap()),
            13 => Insn::ByteSeq13(seq.try_into().unwrap()),
            14 => Insn::ByteSeq14(seq.try_into().unwrap()),
            15 => Insn::ByteSeq15(seq.try_into().unwrap()),
            16 => Insn::ByteSeq16(seq.try_into().unwrap()),
            _ => panic!("Unexpected chunk size"),
        };
        self.emit_insn(insn);
    }

    // Emit a sequence of code points, lowering to literal bytes (UTF-8).
    #[cfg(not(feature = "utf16"))]
    fn emit_code_point_sequence(&mut self, cps: &[u32], icase: bool) {
        let pieces = lower_code_point_sequence(cps, icase, self.result.flags.unicode);
        for piece in pieces {
            self.emit_node(&Node::from(piece));
        }
    }

    // Emit a sequence of code points, in a UTF-16 friendly way.
    #[cfg(feature = "utf16")]
    fn emit_code_point_sequence(&mut self, cps: &[u32], icase: bool) {
        let unicode = self.result.flags.unicode;
        for &cp in cps {
            let chars = unicode::expand_code_point(cp, icase, unicode);
            let node = match chars.len() {
                0 => panic!("Char should always unfold to at least itself"),
                1 => Node::Char { c: chars[0] },
                2..=MAX_CHAR_SET_LENGTH => Node::CharSet(chars),
                _ => panic!("Unicode case fold exceeded maximum expansion"),
            };
            self.emit_node(&node);
        }
    }

    /// Lower a `Node::StringSet` to a right-leaning chain of `Insn::Alt` over the
    /// alternatives.
    fn emit_string_set(&mut self, alternatives: &[Box<[u32]>], icase: bool) {
        let Some((last, priors)) = alternatives.split_last() else {
            // Empty string sets always fail.
            self.emit_insn(Insn::JustFail);
            return;
        };
        // Instruction offsets to fix up with jumps to the string set end.
        let mut jump_fixups: Vec<u32> = Vec::new();
        // Iterate over all alternatives but the last.
        for cps in priors.iter() {
            // Start with an alt jumping to the next string.
            let alt_idx = self.emit_insn_offset(Insn::Alt { secondary: 0 });
            self.emit_code_point_sequence(cps, icase);
            // On success, jump past the remaining alternatives.
            // On failure, the Alt resumes at the next alternative.
            jump_fixups.push(self.emit_insn_offset(Insn::Jump { target: 0 }));
            let next = self.next_offset(); // where the next alternative starts
            match self.get_insn(alt_idx) {
                Insn::Alt { secondary } => *secondary = next,
                _ => unreachable!("Instruction should be Alt"),
            }
        }
        // Emit the last alternative.
        // Note this naturally falls through to the end of the string set.
        self.emit_code_point_sequence(last, icase);
        // Fix up any "on success" jumps.
        let end = self.next_offset();
        for jump_idx in jump_fixups {
            match self.get_insn(jump_idx) {
                Insn::Jump { target } => *target = end,
                _ => unreachable!("Instruction should be Jump"),
            }
        }
    }

    /// Emit an instruction.
    /// Return the "instruction" as an index.
    fn emit_insn(&mut self, insn: Insn) {
        self.result.insns.push(insn);
    }

    /// Get an instruction at a given index.
    fn get_insn(&mut self, idx: u32) -> &mut Insn {
        &mut self.result.insns[idx as usize]
    }

    /// \return the offset of the next instruction emitted.
    fn next_offset(&self) -> u32 {
        self.result.insns.len() as u32
    }

    fn emit_insn_offset(&mut self, insn: Insn) -> u32 {
        let ret = self.next_offset();
        self.emit_insn(insn);
        ret
    }

    /// Emit instructions corresponding to a given node.
    fn emit_node(&mut self, node: &Node) {
        enum Emitter<'a> {
            Node(&'a Node),
            NodeLoopFinish {
                loop_instruction_index: u32,
            },
            NodeLookaroundAssertionFinish {
                lookaround_instruction_index: u32,
                prev_in_lookbehind: bool,
            },
            NodeAltMiddle {
                alt_instruction_index: u32,
                right_node: &'a Node,
            },
            NodeAltFinish {
                alt_instruction_index: u32,
                jump_instruction_index: u32,
                right_branch_index: u32,
            },
            EndCaptureGroup {
                group: CaptureGroupID,
            },
        }

        let mut stack = vec![Emitter::Node(node)];

        while let Some(inst) = stack.pop() {
            match inst {
                Emitter::NodeLoopFinish {
                    loop_instruction_index,
                } => {
                    self.emit_insn(Insn::LoopAgain {
                        begin: loop_instruction_index,
                    });
                    // Fix up our loop exit.
                    let exit = self.next_offset();
                    match self.get_insn(loop_instruction_index) {
                        Insn::EnterLoop(fields) => fields.exit = exit,
                        _ => panic!("Should be an EnterLoop instruction"),
                    }
                }
                Emitter::NodeLookaroundAssertionFinish {
                    lookaround_instruction_index,
                    prev_in_lookbehind,
                } => {
                    self.emit_insn(Insn::Goal);
                    // Fix up the continuation.
                    let next_insn = self.next_offset();
                    match self.get_insn(lookaround_instruction_index) {
                        Insn::Lookbehind { continuation, .. } => *continuation = next_insn,
                        Insn::Lookahead { continuation, .. } => *continuation = next_insn,
                        _ => panic!("Should be a Lookaround instruction"),
                    }
                    self.in_lookbehind = prev_in_lookbehind;
                }
                Emitter::NodeAltMiddle {
                    alt_instruction_index,
                    right_node,
                } => {
                    let jump_insn = self.emit_insn_offset(Insn::Jump { target: 0 });
                    let right_branch = self.next_offset();
                    stack.push(Emitter::NodeAltFinish {
                        alt_instruction_index,
                        jump_instruction_index: jump_insn,
                        right_branch_index: right_branch,
                    });
                    stack.push(Emitter::Node(right_node));
                }
                Emitter::NodeAltFinish {
                    alt_instruction_index,
                    jump_instruction_index,
                    right_branch_index,
                } => {
                    let exit = self.next_offset();
                    // Fix up our jump targets.
                    match self.get_insn(alt_instruction_index) {
                        Insn::Alt { secondary } => *secondary = right_branch_index,
                        _ => panic!("Should be an Alt instruction"),
                    }
                    match self.get_insn(jump_instruction_index) {
                        Insn::Jump { target } => *target = exit,
                        _ => panic!("Should be a Jump instruction"),
                    }
                }
                Emitter::EndCaptureGroup { group } => self.emit_insn(Insn::EndCaptureGroup(group)),
                Emitter::Node(node) => match node {
                    Node::Empty => {}
                    Node::Goal => self.emit_insn(Insn::Goal),
                    Node::Char { c } => self.emit_insn(Insn::Char(*c)),
                    Node::Cat(children) => {
                        for nn in children.iter().rev() {
                            stack.push(Emitter::Node(nn));
                        }
                    }
                    Node::Alt(left, right) => {
                        // Alternation is followed by the primary branch and has a jump to secondary
                        // branch. After primary branch, jump to the continuation.
                        let alt_insn = self.emit_insn_offset(Insn::Alt { secondary: 0 });
                        stack.push(Emitter::NodeAltMiddle {
                            alt_instruction_index: alt_insn,
                            right_node: right,
                        });
                        stack.push(Emitter::Node(left));
                    }
                    Node::Bracket(contents) => {
                        if let Some(ascii_contents) = bracket_as_ascii(contents) {
                            self.emit_insn(Insn::AsciiBracket(ascii_contents))
                        } else {
                            let idx = self.result.brackets.len();
                            self.result.brackets.push(contents.clone());
                            self.emit_insn(Insn::Bracket(idx))
                        }
                    }
                    Node::StringSet {
                        alternatives,
                        icase,
                    } => self.emit_string_set(alternatives, *icase),
                    Node::MatchAny => self.emit_insn(Insn::MatchAny),
                    Node::MatchAnyExceptLineTerminator => {
                        self.emit_insn(Insn::MatchAnyExceptLineTerminator)
                    }
                    Node::Anchor {
                        anchor_type,
                        multiline,
                    } => self.emit_insn(make_anchor(*anchor_type, *multiline)),
                    Node::Loop {
                        loopee,
                        quant,
                        enclosed_groups,
                    } => {
                        let loop_id = self.next_loop_id;
                        self.next_loop_id += 1;
                        let loop_insn = self.emit_insn_offset(Insn::EnterLoop(LoopFields {
                            loop_id,
                            min_iters: quant.min,
                            // If the loop is unbounded, just emit usize::MAX,
                            // as we cannot match more characters than that.
                            max_iters: quant.max.unwrap_or(usize::MAX),
                            greedy: quant.greedy,
                            exit: 0,
                        }));
                        self.result.loops += 1;
                        // Emit a sequence of ResetCaptureGroup for any contained groups.
                        for gid in enclosed_groups.start..enclosed_groups.end {
                            self.emit_insn(Insn::ResetCaptureGroup(gid))
                        }
                        stack.push(Emitter::NodeLoopFinish {
                            loop_instruction_index: loop_insn,
                        });
                        stack.push(Emitter::Node(loopee));
                    }
                    Node::Loop1CharBody { loopee, quant } => {
                        self.emit_insn(Insn::Loop1CharBody {
                            min_iters: quant.min,
                            max_iters: quant.max.unwrap_or(usize::MAX),
                            greedy: quant.greedy,
                        });
                        stack.push(Emitter::Node(loopee));
                    }
                    Node::CaptureGroup { id, contents, name } => {
                        let group = *id;
                        self.result.groups += 1;
                        self.group_names.push(name.as_deref().unwrap_or("").into());
                        self.emit_insn(Insn::BeginCaptureGroup(group));
                        stack.push(Emitter::EndCaptureGroup { group });
                        stack.push(Emitter::Node(contents));
                    }
                    Node::LookaroundAssertion {
                        negate,
                        backwards,
                        start_group,
                        end_group,
                        contents,
                    } => {
                        let lookaround = if *backwards {
                            self.emit_insn_offset(Insn::Lookbehind {
                                negate: *negate,
                                start_group: *start_group,
                                end_group: *end_group,
                                continuation: 0,
                            })
                        } else {
                            self.emit_insn_offset(Insn::Lookahead {
                                negate: *negate,
                                start_group: *start_group,
                                end_group: *end_group,
                                continuation: 0,
                            })
                        };
                        let prev_in_lookbehind = self.in_lookbehind;
                        self.in_lookbehind = *backwards;
                        stack.push(Emitter::NodeLookaroundAssertionFinish {
                            lookaround_instruction_index: lookaround,
                            prev_in_lookbehind,
                        });
                        stack.push(Emitter::Node(contents));
                    }
                    &Node::WordBoundary {
                        invert,
                        unicode_icase,
                    } => {
                        if unicode_icase {
                            self.emit_insn(Insn::WordBoundaryUnicodeICase { invert })
                        } else {
                            self.emit_insn(Insn::WordBoundary { invert })
                        }
                    }
                    &Node::BackRef { group, icase } => {
                        debug_assert!(group >= 1, "Group should not be zero");
                        // -1 because \1 matches the first capture group, which has index 0.
                        self.emit_insn(Insn::BackRef {
                            group: group - 1,
                            icase,
                        })
                    }

                    Node::ByteSet(bytes) => self.emit_byte_set_insn(bytes),

                    Node::CharSet(chars) => {
                        debug_assert!(chars.len() <= MAX_CHAR_SET_LENGTH);
                        if chars.is_empty() {
                            self.emit_insn(Insn::JustFail);
                        } else {
                            let mut arr = [chars[0]; MAX_CHAR_SET_LENGTH];
                            arr[..chars.len()].copy_from_slice(chars.as_slice());
                            self.emit_insn(Insn::CharSet(arr))
                        }
                    }

                    Node::ByteSequence(bytes) => {
                        // In a lookbehind, instruction order is reversed, but ByteSequence contents are not,
                        // to take advantage of optimized memcmp. For example, `(?<=abcd)` may be emitted
                        // as "d", "c", "b", "a" char matches (traversing input from right to left), or
                        // optimized to a single forwards ByteSequence("abcd"), which matches left-to-right.
                        // Therefore if we split a byte sequence into multiple instructions,
                        // we need to emit them in reverse order iff in a lookbehind.
                        let chunks = bytes.as_slice().chunks(MAX_BYTE_SEQ_LENGTH);
                        if self.in_lookbehind {
                            for chunk in chunks.rev() {
                                self.emit_byte_sequence_insn(chunk);
                            }
                        } else {
                            for chunk in chunks {
                                self.emit_byte_sequence_insn(chunk);
                            }
                        }
                    }
                },
            }
        }
    }
}

/// Compile the given IR to a CompiledRegex.
pub fn emit(n: &ir::Regex) -> CompiledRegex {
    let mut emitter = Emitter {
        next_loop_id: 0,
        group_names: Vec::new(),
        in_lookbehind: false,
        result: CompiledRegex {
            insns: Vec::new(),
            brackets: Vec::new(),
            loops: 0,
            groups: 0,
            group_names: Box::new([]),
            flags: n.flags,
            start_pred: startpredicate::predicate_for_re(n),
        },
    };
    emitter.emit_node(&n.node);
    let mut result = emitter.result;
    // Populate group names, unless all are empty.
    debug_assert!(
        result.group_names.is_empty(),
        "Group names should not be set"
    );
    if emitter.group_names.iter().any(|s| !s.is_empty()) {
        result.group_names = emitter.group_names.into_boxed_slice();
    }
    debug_assert!(
        result.group_names.is_empty() || result.group_names.len() == result.groups as usize
    );
    result
}
