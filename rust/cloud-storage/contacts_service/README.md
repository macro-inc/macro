# Contacts Service
A service for adding and querying contacts

## Local development SQS component
### Setting up local SQS with localstack and docker
A small SQS worker has been made to aid in the rapid
development of the contacts service. In this pipeline, one
is able to spin up a local SQS worker using local stack, send
messages to it, and then write those messages to disk.

First, make sure the localstack docker image is installed and
running with `just create-localstack`. If it is already installed,
it can be started with `just start-localstack`.

Create a new SQS queue with `just create-queue`.

### Setting up a local postgres instance
Run macrodb using `docker-compose up macrodb`. See the
top-level README for more information on how to spin this up.

In the contacts-db-client folder, run `just init` to
setup the initial table, followed by `just migrate` to
perform a migration and set up the tables.

Confirm things are working as expected with `just test`.

You can log into postgres instance by runnin `just psql`

### Running the local worker
In the contacts service, run `just sqs-worker` to spin up
a listener.

Send a test message with `just sqs-test-message`. If all goes
well, some connections should appear in the connections table.

Run `just list-connections` to see the connections in the table.

```bash
$ just list-connections
echo "SELECT * FROM connections" | psql -U user contacts
 id | user1  | user2  
----+--------+--------
  1 | apollo | zeus
  2 | apollo | athena
  3 | athena | zeus
(3 rows)
```

It is also possible to send other messages to the SQS service
using `send-message`: `just send-message test/fixtures/connections_message.json`.
