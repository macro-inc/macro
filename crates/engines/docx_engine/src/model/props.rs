//! Formatting properties: run, paragraph, table, row and cell properties as
//! each level of the style hierarchy states them, and resolved.

mod border;
mod color;
mod para;
mod run;
mod table;

pub use border::{Border, LineStyle, read_border};
pub use color::{ColorRef, ThemeInfo, highlight_color, read_color, read_shading};
pub use para::{
    Align, FramePr, LineSpacing, NumPr, PPr, ParaBorders, ParaBordersPr, ParaProps, TabAlign,
    TabLeader, TabStop,
};
pub use run::{DEFAULT_FONT, DEFAULT_SIZE, RPr, RunProps, Underline, UnderlineStyle, VertAlign};
pub use table::{
    BordersPr, HeightRule, MarginsPr, TableLook, TablePosition, TblPr, TcPr, TrPr, VMerge, Width,
    read_width,
};
