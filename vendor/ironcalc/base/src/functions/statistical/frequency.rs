use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    fn collect_freq_values(
        &mut self,
        arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        match self.evaluate_node_in_context(arg, cell) {
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => Ok(v.into_iter().flatten().collect()),
                Err(e) => Err(e),
            },
            CalcResult::Array(arr) => match self.values_from_array(arr) {
                Ok(v) => Ok(v.into_iter().flatten().collect()),
                Err(e) => Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    format!("{:?}", e),
                )),
            },
            CalcResult::Number(n) => Ok(vec![n]),
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(vec![]),
            _ => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "FREQUENCY: expected numeric range".to_string(),
            )),
        }
    }

    // FREQUENCY(data_array, bins_array)
    // Returns a vertical array: result[i] = count of values in the i-th bin interval.
    // The result has one more element than bins_array.
    pub(crate) fn fn_frequency(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.collect_freq_values(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let bins_raw = match self.collect_freq_values(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if bins_raw.is_empty() {
            return CalcResult::Array(vec![vec![ArrayNode::Number(data.len() as f64)]]);
        }

        let n_bins = bins_raw.len();

        // Sort bins by value but remember their original positions so that output
        // is placed back in the original (unsorted) bin order, matching Excel.
        let mut indexed_bins: Vec<(f64, usize)> = bins_raw
            .into_iter()
            .enumerate()
            .map(|(i, v)| (v, i))
            .collect();
        indexed_bins.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        // sorted_bins[i] = (value, original_index)
        let sorted_vals: Vec<f64> = indexed_bins.iter().map(|&(v, _)| v).collect();

        // counts[i] is the count for sorted bin i; counts[n_bins] is the overflow bucket.
        let mut sorted_counts = vec![0u64; n_bins + 1];
        for &val in &data {
            let idx = sorted_vals.partition_point(|&b| b < val);
            sorted_counts[idx] += 1;
        }

        // Map sorted counts back to original bin positions.
        let mut result_counts = vec![0u64; n_bins + 1];
        for (sorted_idx, &(_, orig_idx)) in indexed_bins.iter().enumerate() {
            result_counts[orig_idx] = sorted_counts[sorted_idx];
        }
        // The overflow bucket is always last.
        result_counts[n_bins] = sorted_counts[n_bins];

        let result: Vec<Vec<ArrayNode>> = result_counts
            .iter()
            .map(|&c| vec![ArrayNode::Number(c as f64)])
            .collect();

        CalcResult::Array(result)
    }
}
