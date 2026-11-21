use aws_sdk_cloudwatch::types::StandardUnit;

use super::*;
use std::collections::BTreeMap;

use crate::metrics::Metric;

#[test]
fn counts_go_out_as_one_value_and_samples_as_values_with_counts() {
    let batch = Batch {
        sums: [(Metric::JevCostUsd, 0.25)].into(),
        samples: [(Metric::SweepSeconds, vec![3.0, 3.0, 9.5])].into(),
    };

    let data = datums(&batch, "prod");
    assert_eq!(data.len(), 2);
    let cost = &data[0];
    assert_eq!(cost.metric_name(), Some("JevCostUsd"));
    assert_eq!(cost.value(), Some(0.25));
    assert_eq!(cost.unit(), Some(&StandardUnit::None));
    let dimension = &cost.dimensions()[0];
    assert_eq!(
        (dimension.name(), dimension.value()),
        (Some("Environment"), Some("prod"))
    );
    let sweep = &data[1];
    assert_eq!(sweep.metric_name(), Some("SweepSeconds"));
    assert_eq!(sweep.values(), &[3.0, 9.5]);
    assert_eq!(sweep.counts(), &[2.0, 1.0]);
    assert_eq!(sweep.unit(), Some(&StandardUnit::Seconds));
}

#[test]
fn many_distinct_samples_split_across_datums() {
    let batch = Batch {
        sums: BTreeMap::new(),
        samples: [(
            Metric::StaleThreadsSeconds,
            (0..400_u32).map(|n| f64::from(n) / 100.0).collect(),
        )]
        .into(),
    };

    let data = datums(&batch, "dev");
    let sizes: Vec<_> = data.iter().map(|datum| datum.values().len()).collect();
    assert_eq!(sizes, vec![150, 150, 100]);
    assert!(
        data.iter()
            .all(|datum| datum.metric_name() == Some("StaleThreadsSeconds"))
    );
}
