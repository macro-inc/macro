//! Production-shaped workloads for the GraphQL cache engine: generates the
//! responses the app's backfill lanes and foreground views would write, from
//! the app's own documents and schema, so native and browser runs replay the
//! same bytes.

mod check;
mod dataset;
mod faker;
mod rng;

use clap::{Parser, Subcommand};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write `docs.json`, `seed.ndjson` and `foreground.ndjson` for a tier.
    Generate {
        /// tiny, p50 or p90.
        #[arg(long)]
        tier: String,
        /// Directory of `<OperationName>.graphql` files printed from the app.
        #[arg(long)]
        documents: PathBuf,
        #[arg(long)]
        schema: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 1)]
        seed: u64,
    },
    /// Check that every op in a generated dataset projects completely.
    Check {
        /// Directory written by `generate`.
        #[arg(long)]
        data: PathBuf,
    },
}

fn io(error: impl std::fmt::Display) -> rootcause::Report {
    rootcause::report!("{error}")
}

fn main() -> Result<(), rootcause::Report> {
    match Cli::parse().command {
        Command::Generate {
            tier,
            documents,
            schema,
            out,
            seed,
        } => {
            let tier_spec =
                dataset::tier(&tier).ok_or_else(|| rootcause::report!("unknown tier {tier}"))?;
            let sdl = std::fs::read_to_string(&schema).map_err(io)?;
            let faker = faker::Faker::new(&sdl)?;
            let mut sources = BTreeMap::new();
            let mut parsed = BTreeMap::new();
            for name in dataset::DOCUMENTS {
                let source = std::fs::read_to_string(documents.join(format!("{name}.graphql")))
                    .map_err(io)?;
                parsed.insert(*name, faker.parse(&source)?);
                sources.insert((*name).to_owned(), source);
            }
            // Row fragments the read pass selects through `readRecordsByKeys`.
            for name in dataset::FRAGMENTS {
                let source =
                    std::fs::read_to_string(documents.join(format!("{name}.fragment.graphql")))
                        .map_err(io)?;
                sources.insert(format!("fragment:{name}"), source);
            }
            std::fs::create_dir_all(&out).map_err(io)?;
            std::fs::write(
                out.join("docs.json"),
                serde_json::to_vec_pretty(&sources).map_err(io)?,
            )
            .map_err(io)?;
            let (identity, entities) = dataset::entities(&tier_spec, seed);
            for (file, foreground) in [("seed.ndjson", false), ("foreground.ndjson", true)] {
                let mut writer =
                    std::io::BufWriter::new(std::fs::File::create(out.join(file)).map_err(io)?);
                let mut count = 0usize;
                let mut bytes = 0usize;
                let mut emit = |op: dataset::Op| -> Result<(), rootcause::Report> {
                    let line = serde_json::to_vec(&op.to_json()).map_err(io)?;
                    bytes += line.len();
                    count += 1;
                    writer.write_all(&line).map_err(io)?;
                    writer.write_all(b"\n").map_err(io)
                };
                if foreground {
                    dataset::foreground_ops(
                        &faker, &parsed, &identity, &entities, &tier_spec, &mut emit,
                    )?;
                } else {
                    dataset::seed_ops(
                        &faker, &parsed, &identity, &entities, &tier_spec, &mut emit,
                    )?;
                }
                writer.flush().map_err(io)?;
                println!("{file}: {count} ops, {:.1} MB", bytes as f64 / 1e6);
            }
            let meta = serde_json::json!({
                "tier": tier,
                "seed": seed,
                "viewerId": identity.viewer_id,
                "linkIds": identity.link_ids,
                "threadIds": entities.threads.iter().take(tier_spec.body_threads).map(|t| &t.id).collect::<Vec<_>>(),
            });
            std::fs::write(
                out.join("meta.json"),
                serde_json::to_vec_pretty(&meta).map_err(io)?,
            )
            .map_err(io)?;
            Ok(())
        }
        Command::Check { data } => {
            if check::run(&data)? {
                Ok(())
            } else {
                Err(rootcause::report!("dataset has incomplete projections"))
            }
        }
    }
}
