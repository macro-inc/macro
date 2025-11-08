# Comms (Communication) Service 

# Overview
Restful api for dealing with channels & messages, stores information in comms db using the [comms_db_client](../comms_db_client).

## Building & Running Locally

Ussually it is sufficient to build with the `SQLX_OFFLINE=true` flag.  
```bash
SQLX_OFFLINE=true cargo build
```

``` bash
cargo run --features local_auth 
```

`local_auth` feature will automatically inject a valid jwt token into the request header.
To set the user_id you can set the `LOCAL_USER_ID` environemnt variable.


## Interactions With `connection_gateway`
Comms Service uses the `connection_gateway` to send channel / message updates to to the client.

Things like:
- sending a message to a channel
- reacting to a message
- editing a message
- deleting a message

are all events that are broadcasted to the client by the comms service through the `connection_gateway`.

In most cases the recipients are the participants of the channel.

Most push operations to the comms service are done via http, vs updates happen via the connection gateway websocket connection.
HTTP requests provide more reliable delivery and tracking of the request.


### Running With `connection_gateway` Locally

By default the `.env.sample` file points to the `connection_gateway` in dev.

To run this with the `connection_gateway` locally, you should follow the instructions in [connection_gateway](../connection_gateway);

NOTE: ensure your `INTERNAL_API_SECRET_KEY` defined in this `.env` and the one in the `connection_gateway` match up.

## Interactions with `comms_db_client`

It's recommended to just use the `DATABASE_URL` pointing to the dev instance of `comms` which is the name of the comms database.

If required, you can just point to a local instance of comms.

Please see the [comms_db_client](../comms_db_client) for more details.

## Interactions with `macro_notify`

The `macro_notify` crate is used to send notifications to the client.

While this also uses the `connection_gateway`, notifications are seperate from the websocket updates the comms service send directly to the gateway.  


# Technical Documentation

## Creating Channels

`POST /channels`: is the most extensible endpoint for creating channels.

`POST /channels/get_or_create_dm {recipient}`: 
For `direct_message` channels, there is a `get_or_create_dm` endpoint.
This is useful because ideally there should only be one direct message channel for each permutaton of two users.

`POST /channels/get_or_create_private {recipients: []}`:
Similarly for `private` channels, there is a `get_or_create_private` endpoint.
