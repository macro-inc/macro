// FINDB, LEFTB, LENB, MIDB, REPLACEB, RIGHTB, SEARCHB
//
// IronCalc does not implement DBCS (Double Byte Character Set) locales.
// For non-DBCS locales all *B functions behave identically to their non-B
// counterparts, so we simply delegate.

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, types::CellReferenceIndex},
    model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_findb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_find(args, cell)
    }

    pub(crate) fn fn_leftb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_left(args, cell)
    }

    pub(crate) fn fn_lenb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_len(args, cell)
    }

    pub(crate) fn fn_midb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_mid(args, cell)
    }

    pub(crate) fn fn_replaceb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_replace(args, cell)
    }

    pub(crate) fn fn_rightb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_right(args, cell)
    }

    pub(crate) fn fn_searchb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_search(args, cell)
    }
}
