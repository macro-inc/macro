use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, types::CellReferenceIndex},
    model::Model,
};

impl<'a> Model<'a> {
    // ENCODEURL(text)
    // Percent-encodes every byte of the UTF-8 representation of `text` except
    // the RFC 3986 unreserved characters: A-Z, a-z, 0-9, '-', '.', '_' and '~'.
    // Hexadecimal digits are uppercase, matching Excel.
    pub(crate) fn fn_encodeurl(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let mut result = String::with_capacity(text.len());
        for byte in text.as_bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    result.push(*byte as char);
                }
                _ => result.push_str(&format!("%{byte:02X}")),
            }
        }
        CalcResult::String(result)
    }
}
