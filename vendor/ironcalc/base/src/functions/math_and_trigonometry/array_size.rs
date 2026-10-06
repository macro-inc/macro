use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::token::Error;

// Arbitrary limit to prevent creating huge arrays that would crash the program.
// A better way would be to look at the memory available
const MAX_SIZE: usize = 1_000_000;

pub fn check_array_size(rows: usize, columns: usize) -> Option<(Error, String)> {
    if columns > LAST_COLUMN as usize {
        return Some((
            Error::VALUE,
            format!("columns exceeds sheet limit of {LAST_COLUMN}"),
        ));
    }

    if rows > LAST_ROW as usize {
        return Some((
            Error::VALUE,
            format!("rows exceeds sheet limit of {LAST_ROW}"),
        ));
    }

    // If rows * columns exceeds MAX_SIZE, return #VALUE!
    // Otherwise this would be an easy way to crash the program by trying to create a huge array.
    // NB: This is a limitation of IronCalc
    if rows * columns > MAX_SIZE {
        return Some((
            Error::ERROR,
            format!("rows * columns exceeds matrix size limit of {}", MAX_SIZE),
        ));
    }
    None
}
