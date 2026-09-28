use super::corpus::Query;
use cache_turso::{TursoFileDatabase, TursoStorage};
use clap::Parser;
use serde::Serialize;
use std::{path::PathBuf, time::Instant};

#[derive(Parser, Serialize)]
#[command(about = "Benchmark every production GraphQL cache query (release mode required)")]
pub struct Options {
    /// Top-level list cardinalities; nested collections contain two items.
    #[arg(long, value_delimiter = ',', default_value = "1,50,250")]
    pub sizes: Vec<usize>,
    /// Distinct cached argument variants for the scaling workloads.
    #[arg(long, value_delimiter = ',', default_value = "32,128")]
    pub variants: Vec<usize>,
    /// Exact durable normalized-record populations, independent of response size.
    /// Each selected fixture must fit; use --sizes 1 for the 50-record matrix.
    #[arg(long, value_delimiter = ',')]
    pub cache_records: Vec<usize>,
    /// Restrict measured scenarios (setup and correctness checks still run).
    #[arg(long, value_delimiter = ',')]
    pub scenarios: Vec<String>,
    #[arg(long, default_value_t = 30)]
    pub samples: usize,
    #[arg(long, default_value_t = 5)]
    pub warmup: usize,
    #[arg(long, default_value = "")]
    pub filter: String,
    /// JSON output with per-scenario distributions and discovered operation inventory.
    #[arg(long)]
    pub output: Option<PathBuf>,
    /// Use disposable native files instead of in-memory Turso databases.
    #[arg(long)]
    pub disk: bool,
    // cargo bench passes this flag to custom harnesses.
    #[arg(long, hide = true)]
    bench: bool,
}

impl Options {
    pub fn validate(&self) {
        assert!(
            !cfg!(debug_assertions),
            "run with cargo bench (optimized build)"
        );
        assert!(self.samples > 0 && self.sizes.iter().all(|size| *size > 0));
        assert!(self.variants.iter().all(|count| *count > 0));
        assert!(self.cache_records.iter().all(|count| *count > 0));
    }
}

pub struct Databases {
    directory: tempfile::TempDir,
    next: std::cell::Cell<usize>,
    disk: bool,
}

impl Databases {
    pub fn new(disk: bool) -> Self {
        Self {
            directory: tempfile::tempdir().unwrap(),
            next: std::cell::Cell::new(0),
            disk,
        }
    }

    pub fn open(&self) -> TursoStorage {
        if !self.disk {
            return TursoStorage::open_in_memory("graphql-benchmark").unwrap();
        }
        let index = self.next.get();
        self.next.set(index + 1);
        TursoFileDatabase::new(self.directory.path().join(format!("cache-{index}.db")))
            .unwrap()
            .open("graphql-benchmark")
            .unwrap()
    }
}

#[derive(Serialize)]
pub struct Row {
    operation: String,
    size: usize,
    normalized_records: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_records: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hot_capacity: Option<usize>,
    requests_per_read: usize,
    scenario: String,
    samples: usize,
    min_us: f64,
    p50_us: f64,
    p95_us: f64,
    max_us: f64,
    mean_us: f64,
    samples_us: Vec<f64>,
}

#[derive(Serialize)]
pub struct Report {
    host: String,
    options: serde_json::Value,
    architecture: String,
    schema_hash: String,
    disk: bool,
    inventory: Vec<(String, String)>,
    rows: Vec<Row>,
    #[serde(skip)]
    samples: usize,
    #[serde(skip)]
    warmup: usize,
    #[serde(skip)]
    population: Option<(usize, usize)>,
    #[serde(skip)]
    scenarios: Vec<String>,
    #[serde(skip)]
    read_requests: usize,
}

impl Report {
    pub fn new(host: &str, options: &Options, queries: &[&Query]) -> Self {
        assert!(
            queries
                .iter()
                .any(|query| query.name.contains(&options.filter)),
            "filter matched no operations"
        );
        eprintln!(
            "{host}: {} discovered queries; {} samples, {} warmups",
            queries.len(),
            options.samples,
            options.warmup
        );
        Self {
            host: host.into(),
            options: serde_json::to_value(options).unwrap(),
            architecture: format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS),
            schema_hash: cache_core::meta::SCHEMA_HASH.into(),
            disk: options.disk,
            inventory: queries
                .iter()
                .map(|query| (query.name.clone(), query.source.clone()))
                .collect(),
            rows: Vec::new(),
            samples: options.samples,
            warmup: options.warmup,
            population: None,
            scenarios: options.scenarios.clone(),
            read_requests: 1,
        }
    }

    pub fn population(&mut self, records: usize, capacity: usize) {
        self.population = Some((records, capacity));
    }

    pub fn read_requests(&mut self, count: usize) {
        self.read_requests = count;
    }

    pub fn measure(
        &mut self,
        query: &Query,
        size: usize,
        records: usize,
        scenario: &str,
        mut run: impl FnMut(),
    ) {
        self.measure_with_setup(query, size, records, scenario, || (), |()| run());
    }

    pub fn measure_with_setup<T>(
        &mut self,
        query: &Query,
        size: usize,
        records: usize,
        scenario: &str,
        mut setup: impl FnMut() -> T,
        mut run: impl FnMut(T),
    ) {
        if !self.scenarios.is_empty() && !self.scenarios.iter().any(|name| name == scenario) {
            return;
        }
        let mut times = Vec::with_capacity(self.samples);
        for i in 0..self.warmup + self.samples {
            let state = setup();
            let start = Instant::now();
            run(state);
            if i >= self.warmup {
                times.push(start.elapsed().as_secs_f64() * 1e6);
            }
        }
        times.sort_by(f64::total_cmp);
        let percentile =
            |percent: usize| times[(times.len() * percent).div_ceil(100).saturating_sub(1)];
        let row = Row {
            operation: query.name.clone(),
            size,
            normalized_records: records,
            cache_records: self.population.map(|(records, _)| records),
            hot_capacity: self.population.map(|(_, capacity)| capacity),
            requests_per_read: if scenario == "concurrent-8-total" {
                8 * self.read_requests
            } else {
                self.read_requests
            },
            scenario: scenario.into(),
            samples: times.len(),
            min_us: times[0],
            p50_us: percentile(50),
            p95_us: percentile(95),
            max_us: times[times.len() - 1],
            mean_us: times.iter().sum::<f64>() / times.len() as f64,
            samples_us: times,
        };
        eprintln!(
            "{:<30} {:>4} {:<20} p50 {:>10.1} us  p95 {:>10.1} us",
            row.operation, size, scenario, row.p50_us, row.p95_us
        );
        self.rows.push(row);
    }

    pub fn finish(self, options: &Options) {
        for (name, _) in &self.inventory {
            if name.contains(&options.filter) {
                assert!(
                    self.rows.iter().any(|row| &row.operation == name),
                    "{name} has no benchmark coverage"
                );
            }
        }
        let output = serde_json::to_string_pretty(&self).unwrap();
        if let Some(path) = &options.output {
            std::fs::write(path, output).unwrap();
        } else {
            println!("{output}");
        }
    }
}
