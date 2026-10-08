use crate::{
    expressions::{parser::Node, token::OpProduct, types::CellReferenceIndex},
    formatter::parser::{ParsePart, Parser},
    functions::Function,
    model::Model,
};

pub enum Units {
    Number {
        #[allow(dead_code)]
        group_separator: bool,
        precision: i32,
        num_fmt: String,
    },
    Currency {
        #[allow(dead_code)]
        group_separator: bool,
        precision: i32,
        num_fmt: String,
        currency: String,
    },
    Percentage {
        #[allow(dead_code)]
        group_separator: bool,
        precision: i32,
        num_fmt: String,
    },
    Date(String),
}

impl Units {
    pub fn get_num_fmt(&self) -> String {
        match self {
            Units::Number { num_fmt, .. } => num_fmt.to_string(),
            Units::Currency { num_fmt, .. } => num_fmt.to_string(),
            Units::Percentage { num_fmt, .. } => num_fmt.to_string(),
            Units::Date(num_fmt) => num_fmt.to_string(),
        }
    }
    pub fn get_precision(&self) -> i32 {
        match self {
            Units::Number { precision, .. } => *precision,
            Units::Currency { precision, .. } => *precision,
            Units::Percentage { precision, .. } => *precision,
            Units::Date(_) => 0,
        }
    }
}

fn get_units_from_format_string(num_fmt: &str) -> Option<Units> {
    let mut parser = Parser::new(num_fmt);
    parser.parse();
    let parts = parser.parts.first()?;
    // We only care about the first part (positive number)
    match parts {
        ParsePart::Number(part) => {
            if part.percent > 0 {
                Some(Units::Percentage {
                    num_fmt: num_fmt.to_string(),
                    group_separator: part.use_thousands,
                    precision: part.precision,
                })
            } else if num_fmt.contains('$') {
                Some(Units::Currency {
                    num_fmt: num_fmt.to_string(),
                    group_separator: part.use_thousands,
                    precision: part.precision,
                    currency: "$".to_string(),
                })
            } else if num_fmt.contains('€') {
                Some(Units::Currency {
                    num_fmt: num_fmt.to_string(),
                    group_separator: part.use_thousands,
                    precision: part.precision,
                    currency: "€".to_string(),
                })
            } else {
                Some(Units::Number {
                    num_fmt: num_fmt.to_string(),
                    group_separator: part.use_thousands,
                    precision: part.precision,
                })
            }
        }
        ParsePart::Date(_) => Some(Units::Date(num_fmt.to_string())),
        ParsePart::Error(_) => None,
        ParsePart::General(_) => None,
    }
}

impl<'a> Model<'a> {
    fn compute_cell_units(&self, cell_reference: &CellReferenceIndex) -> Option<Units> {
        let cell_style_res = &self.get_style_for_cell(
            cell_reference.sheet,
            cell_reference.row,
            cell_reference.column,
        );
        match cell_style_res {
            Ok(style) => get_units_from_format_string(&style.num_fmt),
            Err(_) => None,
        }
    }

    pub(crate) fn compute_node_units(
        &self,
        node: &Node,
        cell: &CellReferenceIndex,
    ) -> Option<Units> {
        match node {
            Node::ReferenceKind {
                sheet_name: _,
                sheet_index,
                absolute_row,
                absolute_column,
                row,
                column,
            } => {
                let mut row1 = *row;
                let mut column1 = *column;
                if !absolute_row {
                    row1 += cell.row;
                }
                if !absolute_column {
                    column1 += cell.column;
                }
                self.compute_cell_units(&CellReferenceIndex {
                    sheet: *sheet_index,
                    row: row1,
                    column: column1,
                })
            }
            Node::RangeKind {
                sheet_name: _,
                sheet_index,
                absolute_row1,
                absolute_column1,
                row1,
                column1,
                absolute_row2: _,
                absolute_column2: _,
                row2: _,
                column2: _,
            } => {
                // We return the unit of the first element
                let mut row1 = *row1;
                let mut column1 = *column1;
                if !absolute_row1 {
                    row1 += cell.row;
                }
                if !absolute_column1 {
                    column1 += cell.column;
                }
                self.compute_cell_units(&CellReferenceIndex {
                    sheet: *sheet_index,
                    row: row1,
                    column: column1,
                })
            }
            Node::OpSumKind {
                kind: _,
                left,
                right,
            } => {
                let left_units = self.compute_node_units(left, cell);
                let right_units = self.compute_node_units(right, cell);
                match (&left_units, &right_units) {
                    (Some(_), None) => left_units,
                    (None, Some(_)) => right_units,
                    (Some(l), Some(r)) => {
                        if l.get_precision() < r.get_precision() {
                            right_units
                        } else {
                            left_units
                        }
                    }
                    (None, None) => None,
                }
            }
            Node::OpProductKind { kind, left, right } => {
                let left_units = self.compute_node_units(left, cell);
                let right_units = self.compute_node_units(right, cell);
                match (&left_units, &right_units) {
                    (
                        Some(Units::Percentage { precision: l, .. }),
                        Some(Units::Percentage { precision: r, .. }),
                    ) => {
                        if l > r {
                            left_units
                        } else {
                            if *r > 1 {
                                return right_units;
                            }
                            // When multiplying percentage we want at least two decimal places
                            Some(Units::Percentage {
                                group_separator: false,
                                precision: 2,
                                num_fmt: "0.00%".to_string(),
                            })
                        }
                    }
                    (
                        Some(Units::Currency {
                            currency,
                            precision,
                            ..
                        }),
                        Some(Units::Percentage { .. }),
                    ) => {
                        match kind {
                            OpProduct::Divide => None,
                            OpProduct::Times => {
                                if *precision > 1 {
                                    return left_units;
                                }
                                // This is tricky, we need at least 2 digit precision
                                // but I do not want to mess with the num_fmt string
                                Some(Units::Currency {
                                    currency: currency.to_string(),
                                    group_separator: true,
                                    precision: 2,
                                    num_fmt: format!("{currency}#,##0.00"),
                                })
                            }
                        }
                    }
                    (
                        Some(Units::Percentage { .. }),
                        Some(Units::Currency {
                            precision,
                            currency,
                            ..
                        }),
                    ) => {
                        match kind {
                            OpProduct::Divide => None,
                            OpProduct::Times => {
                                if *precision > 1 {
                                    return right_units;
                                }
                                // This is tricky, we need at least 2 digit precision
                                // but I do not want to mess with the num_fmt string
                                Some(Units::Currency {
                                    currency: currency.to_string(),
                                    group_separator: true,
                                    precision: 2,
                                    num_fmt: format!("{currency}#,##0.00"),
                                })
                            }
                        }
                    }
                    (Some(Units::Percentage { .. }), _) => right_units,
                    (_, Some(Units::Percentage { .. })) => match kind {
                        OpProduct::Divide => None,
                        OpProduct::Times => left_units,
                    },
                    (None, _) => match kind {
                        OpProduct::Divide => None,
                        OpProduct::Times => right_units,
                    },
                    (_, None) => left_units,
                    (
                        Some(Units::Number { precision: l, .. }),
                        Some(Units::Number { precision: r, .. }),
                    ) => {
                        if l > r {
                            left_units
                        } else {
                            right_units
                        }
                    }
                    (Some(Units::Number { .. }), _) => match kind {
                        OpProduct::Divide => None,
                        OpProduct::Times => right_units,
                    },
                    (_, Some(Units::Number { .. })) => left_units,
                    _ => None,
                }
            }
            Node::FunctionKind { kind, args } => self.compute_function_units(kind, args, cell),
            Node::UnaryKind { kind: _, right } => {
                // What happens if kind => OpUnary::Percentage?
                self.compute_node_units(right, cell)
            }
            // The rest of the nodes return None
            Node::BooleanKind(_) => None,
            Node::NumberKind(_) => None,
            Node::StringKind(_) => None,
            Node::WrongReferenceKind { .. } => None,
            Node::WrongRangeKind { .. } => None,
            Node::OpRangeKind { .. } => None,
            Node::OpConcatenateKind { .. } => None,
            Node::ErrorKind(_) => None,
            Node::ParseErrorKind { .. } => None,
            Node::EmptyArgKind => None,
            Node::NamedFunctionKind { .. } => None,
            Node::ArrayKind(_) => None,
            Node::DefinedNameKind(_) => None,
            Node::TableNameKind(_) => None,
            Node::NamedVariableKind { .. } => None,
            Node::CompareKind { .. } => None,
            Node::OpPowerKind { .. } => None,
            Node::ImplicitIntersection { .. } => None,
            Node::SpillRangeOperator { .. } => None,
            Node::LambdaDefKind { .. } => None,
            Node::LambdaCallKind { .. } => None,
        }
    }

    fn compute_function_units(
        &self,
        kind: &Function,
        args: &[Node],
        cell: &CellReferenceIndex,
    ) -> Option<Units> {
        match kind {
            Function::Sum => self.units_fn_sum_like(args, cell),
            Function::Average => self.units_fn_sum_like(args, cell),
            Function::Pmt => self.units_fn_currency(args, cell),
            Function::Fv => self.units_fn_currency(args, cell),
            Function::Nper => self.units_fn_currency(args, cell),
            Function::Npv => self.units_fn_currency(args, cell),
            Function::Irr => self.units_fn_percentage(args, cell),
            Function::Mirr => self.units_fn_percentage(args, cell),
            Function::Sln => self.units_fn_currency(args, cell),
            Function::Syd => self.units_fn_currency(args, cell),
            Function::Db => self.units_fn_currency(args, cell),
            Function::Ddb => self.units_fn_currency(args, cell),
            Function::Cumipmt => self.units_fn_currency(args, cell),
            Function::Cumprinc => self.units_fn_currency(args, cell),
            Function::Tbilleq => self.units_fn_percentage_2(args, cell),
            Function::Tbillprice => self.units_fn_currency(args, cell),
            Function::Tbillyield => self.units_fn_percentage_2(args, cell),
            Function::Date => self.units_fn_dates(args, cell),
            Function::Today => self.units_fn_dates(args, cell),
            Function::Now => self.units_fn_date_times(args, cell),
            _ => None,
        }
    }

    fn units_fn_sum_like(&self, args: &[Node], cell: &CellReferenceIndex) -> Option<Units> {
        // We return the unit of the first argument
        if !args.is_empty() {
            return self.compute_node_units(&args[0], cell);
        }
        None
    }

    fn units_fn_currency(&self, _args: &[Node], _cell: &CellReferenceIndex) -> Option<Units> {
        let currency_symbol = &self.locale.currency.symbol;
        let standard_format = &self.locale.numbers.currency_formats.standard;
        let num_fmt = standard_format.replace('¤', currency_symbol);
        // The "space" in the cldr is a weird space.
        let num_fmt = num_fmt.replace(' ', " ");
        Some(Units::Currency {
            num_fmt,
            group_separator: true,
            precision: 2,
            currency: currency_symbol.to_string(),
        })
    }

    fn units_fn_percentage(&self, _args: &[Node], _cell: &CellReferenceIndex) -> Option<Units> {
        Some(Units::Percentage {
            group_separator: false,
            precision: 0,
            num_fmt: "0%".to_string(),
        })
    }

    fn units_fn_percentage_2(&self, _args: &[Node], _cell: &CellReferenceIndex) -> Option<Units> {
        Some(Units::Percentage {
            group_separator: false,
            precision: 2,
            num_fmt: "0.00%".to_string(),
        })
    }

    fn units_fn_dates(&self, _args: &[Node], _cell: &CellReferenceIndex) -> Option<Units> {
        let mut date_short = self.locale.dates.date_formats.short.clone();
        // FIXME: We want always 4 digit year. So if it is not already the case, we replace yy by yyyy
        if !date_short.contains("yyyy") {
            date_short = date_short.replace("yy", "yyyy");
        }
        Some(Units::Date(date_short.replace(' ', " ")))
    }

    fn units_fn_date_times(&self, _args: &[Node], _cell: &CellReferenceIndex) -> Option<Units> {
        let mut date_short = self.locale.dates.date_formats.short.clone();
        // We want always 4 digit year. So if it is not already the case, we replace yy by yyyy
        if !date_short.contains("yyyy") {
            date_short = date_short.replace("yy", "yyyy");
        }
        // NB: full and medium time formats might include timezone info (in the form of z or zzzz)
        let time_short_template = &self.locale.dates.time_formats.short;
        let time_short = time_short_template.replace('a', "AM/PM");
        // This would be something like: "{1}, {0}"
        let date_time_short_template = &self.locale.dates.date_time_formats.short;
        let date_time_short = date_time_short_template
            .replace("{0}", time_short.trim())
            .replace("{1}", &date_short);

        // FIXME: Remove weird spaces (we should do that in the locale loading phase)
        Some(Units::Date(date_time_short.replace(' ', " ")))
    }
}
