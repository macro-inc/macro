use utoipa::OpenApi;

use crate::api::{
    experiment::{
        self, create::CreateExperimentRequest,
        initialize_user_experiments::InitializeUserExperimentsRequest,
        patch::PatchExperimentRequest,
    },
    health,
    user::{
        self, set_experiment::SetUserExperimentRequest,
        update_experiment::UpdateUserExperimentRequest,
    },
};
use model::{
    experiment::{Experiment, ExperimentOperation},
    response::{EmptyResponse, ErrorResponse},
};

#[derive(OpenApi)]
#[openapi(
        info(
                terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /health
                health::health_handler,

                /// /experiment
                experiment::create::handler,
                experiment::initialize_user_experiments::handler,
                experiment::patch::handler,

                /// /user
                user::set_experiment::handler,
                user::update_experiment::handler,
                user::get_active_experiments::handler,
        ),
        components(
            schemas(
                        EmptyResponse,
                        ErrorResponse,
                        Experiment,
                        ExperimentOperation,
                        CreateExperimentRequest,
                        PatchExperimentRequest,
                        InitializeUserExperimentsRequest,
                        SetUserExperimentRequest,
                        UpdateUserExperimentRequest,
                ),
        ),
        tags(
            (name = "experiment service", description = "Macro Experiment Service")
        )
    )]
pub struct ApiDoc;
