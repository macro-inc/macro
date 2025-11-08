**DEPLOYMENT STEPS**
***(VERY IMPORTANT!!)***

1. Whenever you add/remove a job type here, please ensure that the corresponding job types are updated in the websocket package by updating the version id. This ensures the websocket is deployed with updated routes.
2. You will also want to update the job types at `macro-api/websocket/handlers/job_types/src/job_type.rs` which is used for permissions mapping (i.e. map between user permissions and which job types they can invoke since the connection does not automatically block invocations once established). Note, however that this mapping is true by default for everything currently.
3. As noted in the websocket package README, if there is a cached build, you will need to invalidate the cache when deploying since our pulumi diff handler checks for source code mismatches. This works fine for the job types rust package but upstream dependencies like the jobs handler will not be correctly updated. *Not a problem for current CI*.
4. After the websocket code is deployed through Pulumi, you may still need to manually deploy the websocket API Gateway for the changes to propagate. This should be fixed to prevent brittleness in our CI/CD pipeline but make sure to do this everytime as it is important. This is specifically the case when you are adding/modifying a websocket route: it will show up in the console but it will not be deployed.
