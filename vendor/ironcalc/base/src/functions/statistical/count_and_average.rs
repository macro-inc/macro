use std::cmp::Ordering;

use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::number_format::parse_finite_number;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn for_each_value<F>(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mut f: F,
    ) -> Result<(), CalcResult>
    where
        F: FnMut(f64),
    {
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    f(value);
                }
                CalcResult::Boolean(value) if !matches!(arg, Node::ReferenceKind { .. }) => {
                    f(if value { 1.0 } else { 0.0 });
                }
                CalcResult::String(value) if !matches!(arg, Node::ReferenceKind { .. }) => {
                    if let Some(parsed) = self.cast_number(&value) {
                        f(parsed);
                    } else {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Argument cannot be cast into number".to_string(),
                        ));
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for value in row {
                            match value {
                                ArrayNode::Number(value) => {
                                    f(value);
                                }
                                ArrayNode::Boolean(b) => {
                                    f(if b { 1.0 } else { 0.0 });
                                }
                                ArrayNode::Error(error) => {
                                    return Err(CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    });
                                }
                                _ => {
                                    // ignore non-numeric
                                }
                            }
                        }
                    }
                }
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        ));
                    }

                    for row in left.row..=right.row {
                        for column in left.column..=right.column {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::Number(value) => {
                                    f(value);
                                }
                                error @ CalcResult::Error { .. } => return Err(error),
                                CalcResult::Range { .. } => {
                                    return Err(CalcResult::new_error(
                                        Error::ERROR,
                                        cell,
                                        "Unexpected Range".to_string(),
                                    ));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return Err(error),
                // Everything else is ignored
                _ => {}
            }
        }

        Ok(())
    }

    fn for_each_value_a<F>(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mut f: F,
    ) -> Result<(), CalcResult>
    where
        F: FnMut(f64),
    {
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    f(value);
                }
                CalcResult::Boolean(value) if !matches!(arg, Node::ReferenceKind { .. }) => {
                    f(if value { 1.0 } else { 0.0 });
                }
                CalcResult::String(value) if !matches!(arg, Node::ReferenceKind { .. }) => {
                    if let Some(parsed) = self.cast_number(&value) {
                        f(parsed);
                    } else {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Argument cannot be cast into number".to_string(),
                        ));
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for value in row {
                            match value {
                                ArrayNode::Number(value) => {
                                    f(value);
                                }
                                ArrayNode::Boolean(b) => {
                                    f(if b { 1.0 } else { 0.0 });
                                }
                                ArrayNode::String(_) => {
                                    f(0.0);
                                }
                                ArrayNode::Error(error) => {
                                    return Err(CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    });
                                }
                                ArrayNode::Empty => {}
                            }
                        }
                    }
                }
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        ));
                    }

                    for row in left.row..=right.row {
                        for column in left.column..=right.column {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::Number(value) => {
                                    f(value);
                                }
                                CalcResult::Boolean(b) => {
                                    f(if b { 1.0 } else { 0.0 });
                                }
                                CalcResult::String(_) => {
                                    f(0.0);
                                }
                                error @ CalcResult::Error { .. } => return Err(error),
                                CalcResult::Range { .. } => {
                                    return Err(CalcResult::new_error(
                                        Error::ERROR,
                                        cell,
                                        "Unexpected Range".to_string(),
                                    ));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return Err(error),
                // Everything else is ignored
                _ => {}
            }
        }

        Ok(())
    }

    pub(crate) fn fn_average(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut count = 0.0;
        let mut sum = 0.0;
        if let Err(e) = self.for_each_value(args, cell, |f| {
            count += 1.0;
            sum += f;
        }) {
            return e;
        }

        if count == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by Zero".to_string(),
            };
        }
        CalcResult::Number(sum / count)
    }

    pub(crate) fn fn_averagea(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut count = 0.0;
        let mut sum = 0.0;
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..(right.row + 1) {
                        for column in left.column..(right.column + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::String(_) => count += 1.0,
                                CalcResult::Number(value) => {
                                    count += 1.0;
                                    sum += value;
                                }
                                CalcResult::Boolean(b) => {
                                    if b {
                                        sum += 1.0;
                                    }
                                    count += 1.0;
                                }
                                error @ CalcResult::Error { .. } => return error,
                                CalcResult::Range { .. } => {
                                    return CalcResult::new_error(
                                        Error::ERROR,
                                        cell,
                                        "Unexpected Range".to_string(),
                                    );
                                }
                                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                                    return CalcResult::Error {
                                        error: Error::NIMPL,
                                        origin: cell,
                                        message: "Arrays not supported yet".to_string(),
                                    }
                                }
                            }
                        }
                    }
                }
                CalcResult::Number(value) => {
                    count += 1.0;
                    sum += value;
                }
                CalcResult::String(s) => {
                    if let Node::ReferenceKind { .. } = arg {
                        // Do nothing
                        count += 1.0;
                    } else if let Some(t) = parse_finite_number(&s) {
                        sum += t;
                        count += 1.0;
                    } else {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Argument cannot be cast into number".to_string(),
                        };
                    }
                }
                CalcResult::Boolean(b) => {
                    count += 1.0;
                    if b {
                        sum += 1.0;
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "Arrays not supported yet".to_string(),
                    }
                }
            };
        }
        if count == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by Zero".to_string(),
            };
        }
        CalcResult::Number(sum / count)
    }

    pub(crate) fn fn_count(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut result = 0.0;
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(_) => {
                    result += 1.0;
                }
                CalcResult::Boolean(_) if !matches!(arg, Node::ReferenceKind { .. }) => {
                    result += 1.0;
                }
                CalcResult::String(s)
                    if !matches!(arg, Node::ReferenceKind { .. })
                        && parse_finite_number(&s).is_some() =>
                {
                    result += 1.0;
                }
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..(right.row + 1) {
                        for column in left.column..(right.column + 1) {
                            if let CalcResult::Number(_) = self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                result += 1.0;
                            }
                        }
                    }
                }
                _ => {
                    // Ignore everything else
                }
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_counta(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut result = 0.0;
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..(right.row + 1) {
                        for column in left.column..(right.column + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                                _ => {
                                    result += 1.0;
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(a) => {
                    for row in a {
                        for node in row {
                            if !matches!(node, crate::expressions::parser::ArrayNode::Empty) {
                                result += 1.0;
                            }
                        }
                    }
                }
                _ => {
                    result += 1.0;
                }
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_countblank(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // COUNTBLANK requires only one argument
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let mut result = 0.0;
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::EmptyCell | CalcResult::EmptyArg => result += 1.0,
                CalcResult::String(s) if s.is_empty() => result += 1.0,
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..(right.row + 1) {
                        for column in left.column..(right.column + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::EmptyCell | CalcResult::EmptyArg => result += 1.0,
                                CalcResult::String(s) if s.is_empty() => result += 1.0,
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_avedev(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        let mut sum = 0.0;
        let mut count: u64 = 0;

        #[inline]
        fn accumulate(values: &mut Vec<f64>, sum: &mut f64, count: &mut u64, value: f64) {
            values.push(value);
            *sum += value;
            *count += 1;
        }

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    accumulate(&mut values, &mut sum, &mut count, value);
                }
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }

                    let row1 = left.row;
                    let mut row2 = right.row;
                    let column1 = left.column;
                    let mut column2 = right.column;

                    match self.clip_to_used_area(left.sheet, row1, column1, row2, column2) {
                        Ok((r, c)) => {
                            row2 = r;
                            column2 = c;
                        }
                        Err(message) => return CalcResult::new_error(Error::ERROR, cell, message),
                    }

                    for row in row1..=row2 {
                        for column in column1..=column2 {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::Number(value) => {
                                    accumulate(&mut values, &mut sum, &mut count, value);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // ignore non-numeric
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for value in row {
                            match value {
                                ArrayNode::Number(value) => {
                                    accumulate(&mut values, &mut sum, &mut count, value);
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // ignore non-numeric
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // ignore non-numeric
                }
            }
        }

        if count == 0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "AVEDEV with no numeric data".to_string(),
            );
        }

        let n = count as f64;
        let mean = sum / n;

        let mut sum_abs_dev = 0.0;
        for v in &values {
            sum_abs_dev += (v - mean).abs();
        }

        CalcResult::Number(sum_abs_dev / n)
    }

    pub(crate) fn fn_median(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        if values.is_empty() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "No numeric values for MEDIAN".to_string(),
            };
        }

        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

        let n = values.len();
        let median = if n % 2 == 1 {
            // odd
            values[n / 2]
        } else {
            // even: average of the two middle values
            let a = values[(n / 2) - 1];
            let b = values[n / 2];
            (a + b) / 2.0
        };

        CalcResult::Number(median)
    }

    pub(crate) fn fn_harmean(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        if values.is_empty() {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by Zero".to_string(),
            };
        }

        // Excel HARMEAN: all values must be > 0
        if values.iter().any(|&v| v <= 0.0) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "HARMEAN requires strictly positive values".to_string(),
            };
        }

        let n = values.len() as f64;
        let sum_recip: f64 = values.iter().map(|v| 1.0 / v).sum();

        if sum_recip == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by Zero".to_string(),
            };
        }

        CalcResult::Number(n / sum_recip)
    }

    pub(crate) fn fn_mina(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut mina: Option<f64> = None;
        if let Err(e) = self.for_each_value_a(args, cell, |f| {
            if let Some(m) = mina {
                mina = Some(m.min(f));
            } else {
                mina = Some(f);
            }
        }) {
            return e;
        }
        if let Some(mina) = mina {
            CalcResult::Number(mina)
        } else {
            CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No numeric values for MINA".to_string(),
            }
        }
    }

    pub(crate) fn fn_maxa(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut maxa: Option<f64> = None;
        if let Err(e) = self.for_each_value_a(args, cell, |f| {
            if let Some(m) = maxa {
                maxa = Some(m.max(f));
            } else {
                maxa = Some(f);
            }
        }) {
            return e;
        }
        if let Some(maxa) = maxa {
            CalcResult::Number(maxa)
        } else {
            CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No numeric values for MAXA".to_string(),
            }
        }
    }

    pub(crate) fn fn_skew(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // Sample skewness (Excel SKEW)
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        let n = values.len();
        if n < 3 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "SKEW requires at least 3 data points".to_string(),
            };
        }

        let n_f = n as f64;
        let mean = values.iter().sum::<f64>() / n_f;

        let mut m2 = 0.0;
        for &x in &values {
            let d = x - mean;
            m2 += d * d;
        }

        if m2 == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Zero variance in SKEW".to_string(),
            };
        }

        let s = (m2 / (n_f - 1.0)).sqrt();

        let mut sum_cubed = 0.0;
        for &x in &values {
            let z = (x - mean) / s;
            sum_cubed += z * z * z;
        }

        let skew = (n_f / ((n_f - 1.0) * (n_f - 2.0))) * sum_cubed;
        CalcResult::Number(skew)
    }

    pub(crate) fn fn_skew_p(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // Population skewness (Excel SKEW.P)
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        let n = values.len();
        if n < 2 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "SKEW.P requires at least 2 data points".to_string(),
            };
        }

        let n_f = n as f64;
        let mean = values.iter().sum::<f64>() / n_f;

        let mut m2 = 0.0;
        for &x in &values {
            let d = x - mean;
            m2 += d * d;
        }

        if m2 == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Zero variance in SKEW.P".to_string(),
            };
        }

        let sigma = (m2 / n_f).sqrt();

        let mut sum_cubed = 0.0;
        for &x in &values {
            let z = (x - mean) / sigma;
            sum_cubed += z * z * z;
        }

        let skew_p = sum_cubed / n_f;
        CalcResult::Number(skew_p)
    }

    pub(crate) fn fn_kurt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        let n = values.len();
        if n < 4 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "KURT requires at least 4 data points".to_string(),
            };
        }

        let n_f = n as f64;
        let mean = values.iter().sum::<f64>() / n_f;

        let mut m2 = 0.0;
        for &x in &values {
            let d = x - mean;
            m2 += d * d;
        }

        if m2 == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Zero variance in KURT".to_string(),
            };
        }

        let s = (m2 / (n_f - 1.0)).sqrt();

        let mut sum_fourth = 0.0;
        for &x in &values {
            let z = (x - mean) / s;
            sum_fourth += z * z * z * z;
        }

        let term1 = (n_f * (n_f + 1.0)) / ((n_f - 1.0) * (n_f - 2.0) * (n_f - 3.0)) * sum_fourth;
        let term2 = 3.0 * (n_f - 1.0) * (n_f - 1.0) / ((n_f - 2.0) * (n_f - 3.0));

        let kurt = term1 - term2;
        CalcResult::Number(kurt)
    }

    pub(crate) fn fn_large(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let values = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Array(array) => match self.values_from_array(array) {
                Ok(v) => v,
                Err(e) => {
                    return CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: format!("Unsupported array argument: {}", e),
                    }
                }
            },
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => v,
                Err(e) => return e,
            },
            CalcResult::Boolean(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    vec![Some(if value { 1.0 } else { 0.0 })]
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            CalcResult::Number(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    vec![Some(value)]
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            CalcResult::String(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    if let Some(parsed) = self.cast_number(&value) {
                        vec![Some(parsed)]
                    } else {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Unsupported argument type".to_string(),
                        };
                    }
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            _ => {
                return CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Unsupported argument type".to_string(),
                }
            }
        };
        let k = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(s) => return s,
        };
        if k < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "K must be >= 1".to_string(),
            };
        }
        let mut numeric_values: Vec<f64> = values.into_iter().flatten().collect();
        if numeric_values.is_empty() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "No numeric values for LARGE".to_string(),
            };
        }
        numeric_values.sort_by(|a, b| b.partial_cmp(a).unwrap_or(Ordering::Equal));
        let k_usize = k as usize;
        if k_usize > numeric_values.len() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "K is larger than the number of data points".to_string(),
            };
        }
        CalcResult::Number(numeric_values[k_usize - 1])
    }

    pub(crate) fn fn_small(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let values = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Array(array) => match self.values_from_array(array) {
                Ok(v) => v,
                Err(e) => {
                    return CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: format!("Unsupported array argument: {}", e),
                    }
                }
            },
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => v,
                Err(e) => return e,
            },
            CalcResult::Boolean(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    vec![Some(if value { 1.0 } else { 0.0 })]
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            CalcResult::Number(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    vec![Some(value)]
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            CalcResult::String(value) => {
                if !matches!(args[0], Node::ReferenceKind { .. }) {
                    if let Some(parsed) = self.cast_number(&value) {
                        vec![Some(parsed)]
                    } else {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Unsupported argument type".to_string(),
                        };
                    }
                } else {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    };
                }
            }
            _ => {
                return CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Unsupported argument type".to_string(),
                }
            }
        };

        let k = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(s) => return s,
        };

        if k < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "K must be >= 1".to_string(),
            };
        }

        let mut numeric_values: Vec<f64> = values.into_iter().flatten().collect();
        if numeric_values.is_empty() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "No numeric values for SMALL".to_string(),
            };
        }

        // For SMALL, sort ascending
        numeric_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

        let k_usize = k as usize;
        if k_usize > numeric_values.len() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "K is larger than the number of data points".to_string(),
            };
        }

        CalcResult::Number(numeric_values[k_usize - 1])
    }
}
