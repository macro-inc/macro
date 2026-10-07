pub mod dates;
pub mod format;
pub mod lexer;
pub mod parser;

#[cfg(test)]
mod test;

// Excel formatting is extremely tricky and I think implementing all it's rules might be borderline impossible.
// But the essentials are easy to understand.
//
// A general Excel formatting string is divided iun four parts:
//
// <POSITIVE>;<NEGATIVE>;<ZERO>;<TEXT>
//
// * How many decimal digits do you need?
//
// 0.000 for exactly three
// 0.00??? for at least two and up to five
//
// * Do you need a thousands separator?
//
// #,##
// #      will just write the number
// #,     will write the number up to the thousand separator (if there is nothing else)
//
// But #,# and any number of '#' to the right will work just as good. So the following all produce the same results:
// #,##0.00          #,######0.00            #,0.00
//
// For us in IronCalc the most general format string for a number (non-scientific notation) will be:
//
// 1. Will have #,## at the beginning if we use the thousand separator
// 2. Then 0.0* with as many 0 as mandatory decimal places
// 3. Then ?* with as many question marks as possible decimal places
//
// Valid examples:
// #,##0.???    Thousand separator, up to three decimal digits
// 0.00         No thousand separator. Two mandatory decimal places
// 0.0?         No thousand separator. One mandatory decimal digit and one extra if present.
//
// * Do you what the text in color?
//
// Use [RED] or any color in https://www.excelsupersite.com/what-are-the-56-colorindex-colors-in-excel/

// Weird things
// ============
//
// ####0.0E+00 of 12345467.890123 (changing the number of '#' produces results I do not understand)
// ?www??.????0220000 will format 1234567.890123 to 12345www67.89012223000
//
// Things we will not implement
// ============================
//
// 1.- The accounting format can leave white spaces of the size of a particular character. For instance:
//
//   #,##0.00_);[Red](#,##0.00)
//
// Will leave a white space to the right of positive numbers so that they are always aligned with negative numbers
//
// 2.- Excel can repeat a character as many times as needed to fill the cell:
//
// _($* #,##0_);_($* (#,##0))
//
// This will put a '$' sign to the left most (leaving a space the size of '(') and then as many empty spaces as possible
// and then the number:
//  | $      234 |
//  | $     1234 |
// We can't do this easily in IronCalc
//
// 3.- You can use ?/? to format fractions in Excel (this is probably not too hard)

// TOKENs
// ======
//
// * Color [Red] or [Color 23] or [Color23]
// * Conditions [<100]
// * Currency [$€]
// * Space _X when X is any given char
// * A spacer of chars: *X where X is repeated as much as possible
// * Literals: $, (, ), :, +, - and space
// * Text: "Some Text"
// * Escaped char: \X where X is anything
// * % appears literal and multiplies number by 100
// * , If it's in between digit characters it uses the thousand separator. If it is after the digit characters it multiplies by 1000
// * Digit characters: 0, #, ?
// * ; Types formatter divider
// * @ inserts raw text
// * Scientific literals E+, E-, e+, e-
// * . period. First one is the decimal point, subsequent are literals.

// d day of the month
// dd day of the month (padded i.e 05)
// ddd day of the week abbreviation
// dddd+ day of the week
// mmm Abbreviation month
// mmmm Month name
// mmmmm First letter of the month
// y or yy 2-digit year
// yyy+ 4 digit year

// References
// ==========
//
// [1] https://support.microsoft.com/en-us/office/number-format-codes-5026bbd6-04bc-48cd-bf33-80f18b4eae68?ui=en-us&rs=en-us&ad=us
// [2] https://developers.google.com/sheets/api/guides/formats
// [3] https://docs.microsoft.com/en-us/openspecs/office_standards/ms-oe376/0e59abdb-7f4e-48fc-9b89-67832fa11789
