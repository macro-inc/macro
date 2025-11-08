This package manages the SSOT websocket connection handler that our app uses to communicate with the backend.
For now, I've added in a custom lambda that returns a response by posting "Hello!" to the inbound connection.

Follow the instructions [here](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-wscat.html) to create a connection using
the `wscat` utility.

Here's a command that does that using the `jq` utility and retrieving the current pulumi stack output:

`wscat -c $(pulumi stack output stage | jq -r .invokeUrl)`

Then just type in `{"action":"test-response-handler"}` and you should receive a response back on the web socket within a few seconds.
The route key (which maps to the action) is provided as follows:
`pulumi stack output testResponseRoute | jq .routeKey`

If you wanna update the job types package and re-deploy, you should delete the target lambdas to force a rebuild. This is because the source code hash provider won't notice a change
in the job submission source code.

***IMPORTANT*** See deployment steps README in the job types package.
