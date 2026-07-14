#[macro_export]
macro_rules! compose_layers {
    ($($layer:expr),+ $(,)?) => {
        {
            use tower::ServiceBuilder;
            ServiceBuilder::new()
                $(.layer($layer))+
                .into_inner()
        }
    };
}
