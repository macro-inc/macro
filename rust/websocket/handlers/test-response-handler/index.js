import {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
  } from "@aws-sdk/client-apigatewaymanagementapi";
  
  export const handler = async (event) => {
    console.log(`Event: ${JSON.stringify(event)}`);
    const connectionId = event.requestContext.connectionId;
    const callbackUrl = process.env.API_GATEWAY_ENDPOINT_URL;
    if (!callbackUrl) {
      console.log("API_GATEWAY_ENDPOINT_URL is not set");
      return {
        statusCode: 500,
      };
    }
    const client = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });
  
    const requestParams = {
      ConnectionId: connectionId,
      Data: "pong",
    };
  
    const command = new PostToConnectionCommand(requestParams);
  
    try {
      await client.send(command);
    } catch (error) {
      console.log(error);
    }
  
    return {
      statusCode: 200,
    };
  };