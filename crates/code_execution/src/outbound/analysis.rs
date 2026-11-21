//! The answer an analyzer process prints for a program: the JavaScript tools
//! one's (`js-tools.mjs`'s `analyze`).

use crate::domain::*;

/// An analyzer's JSON answer: `{"status":"ok","operations":[{"service",
/// "operation","method","route","rivals"},..]}`,
/// `{"status":"cannot_analyze","reasons":[{"message","location":{"line",
/// "column"}}]}` or `{"status":"diagnostics","diagnostics":[{"message",
/// "location"?}]}` for a program that doesn't parse. Lines are 1-based,
/// columns 0-based; `file` is the program's file, which locations are in.
/// `None` for anything else.
pub(crate) fn analysis(stdout: &[u8], file: &str) -> Option<Analysis> {
    #[derive(serde::Deserialize)]
    #[serde(tag = "status", rename_all = "snake_case")]
    enum Answer {
        Ok { operations: Vec<Found> },
        CannotAnalyze { reasons: Vec<Reason> },
        Diagnostics { diagnostics: Vec<Problem> },
    }
    #[derive(serde::Deserialize)]
    struct Found {
        service: String,
        operation: String,
        method: String,
        route: String,
        #[serde(default)]
        rivals: Vec<SdkRoute>,
    }
    #[derive(serde::Deserialize)]
    struct Reason {
        message: String,
        location: At,
    }
    #[derive(serde::Deserialize)]
    struct Problem {
        message: String,
        location: Option<At>,
    }
    #[derive(serde::Deserialize)]
    struct At {
        line: u32,
        column: u32,
    }
    Some(match serde_json::from_slice(stdout).ok()? {
        Answer::Ok { operations } => Analysis::Calls(
            operations
                .into_iter()
                .map(|found| SdkCall {
                    operation: SdkOperation {
                        service: found.service,
                        operation_id: found.operation,
                    },
                    method: found.method,
                    route: found.route,
                    rivals: found.rivals,
                })
                .collect(),
        ),
        Answer::CannotAnalyze { reasons } if !reasons.is_empty() => Analysis::CannotAnalyze(
            reasons
                .into_iter()
                .map(|reason| AnalysisReason {
                    message: reason.message,
                    line: reason.location.line,
                    column: reason.location.column + 1,
                })
                .collect(),
        ),
        Answer::Diagnostics { diagnostics } if !diagnostics.is_empty() => Analysis::Diagnostics(
            diagnostics
                .into_iter()
                .map(|problem| Diagnostic {
                    message: match problem.location {
                        Some(At { line, column }) => {
                            format!("{file}:{line}:{}: {}", column + 1, problem.message)
                        }
                        None => format!("{file}: {}", problem.message),
                    },
                    file: Some(file.to_owned()),
                })
                .collect(),
        ),
        Answer::CannotAnalyze { .. } | Answer::Diagnostics { .. } => return None,
    })
}

#[cfg(test)]
mod test;
