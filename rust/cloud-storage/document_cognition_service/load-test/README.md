# DCS Websocket Streaming Load Test

## Usage

1. define a config.json

```json
{
	"num_connections": 20,
	"request_per_connection": 1,
	"base_url": "document-cognition-dev.macro.com",
	"connection_timeout": 60, // seconds
	"ramp_up_duration": 15, // seconds
	"delay_between_connections": 50 //miliseconds
}
```
2. set your `macro-token` as an env variable `TOKEN` 

```bash
export TOKEN="<your_token"
```

3. run command with your config
```bash
cargo run -- config.json
```

## Understanding the output

Here is an example output for the config above:

```bash
Load test report:
Ran 20 connections, across 20 chats, sending up to 20 messages over 53.04606425s
Ramp-up duration: 15s
Delay between connections: 50ms
Messages sent: 20 # how many messages where sent to the server
Messages received: 240 # how many messages where received by the client
Messages acknowledged: 20 # how many messages started streaming
Messages finished: 20 # how many messages finished streaming
Average time to acknowledge message: 89.15ms # average time that a message starts streaming back
Average time to finish message: 708.40ms # average time that a message finished streaming
```
