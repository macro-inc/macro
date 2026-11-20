use super::*;
#[cfg(test)]
mod test;

pub(super) fn sqlstates(source: &anyhow::Error) -> Vec<String> {
    source
        .chain()
        .filter_map(|cause| {
            cause
                .downcast_ref::<sqlx::Error>()?
                .as_database_error()?
                .code()
                .map(|code| code.into_owned())
        })
        .collect()
}

pub(super) fn database_error(source: anyhow::Error) -> BackfillDatabaseError {
    BackfillDatabaseError {
        sqlstates: sqlstates(&source),
        source,
    }
}

pub(super) fn is_unstorable(source: &anyhow::Error) -> bool {
    sqlstates(source)
        .iter()
        .any(|code| is_unstorable_sqlstate(code))
}
