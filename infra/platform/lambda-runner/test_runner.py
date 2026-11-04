import threading
import unittest
import urllib.request
import http.server
import json

import runner


class Events(unittest.TestCase):
    def test_scheduled_event_has_the_eventbridge_shape(self):
        event = runner.scheduled_event(0)
        self.assertEqual(event["detail-type"], "Scheduled Event")
        self.assertEqual(event["time"], "1970-01-01T00:00:00Z")

    def test_sqs_event_names_the_source_queue(self):
        event = runner.sqs_event(
            [{"MessageId": "1", "ReceiptHandle": "r", "Body": "b"}], "q"
        )
        record = event["Records"][0]
        self.assertEqual(record["body"], "b")
        self.assertEqual(record["eventSourceARN"], "arn:aws:sqs:us-east-1:000000000000:q")

    def test_partial_batch_failures_stay_on_the_queue(self):
        messages = [{"MessageId": "1"}, {"MessageId": "2"}]
        kept = runner.handled_messages(
            messages, {"batchItemFailures": [{"itemIdentifier": "2"}]}
        )
        self.assertEqual(kept, [{"MessageId": "1"}])
        self.assertEqual(runner.handled_messages(messages, None), messages)


class RuntimeApi(unittest.TestCase):
    def setUp(self):
        self.invocations = runner.Invocations()
        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), runner.runtime_handler(self.invocations)
        )
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}{runner.API_PREFIX}"

    def tearDown(self):
        self.server.shutdown()

    def handler_round(self, outcome, body=b"{}"):
        with urllib.request.urlopen(f"{self.base}/invocation/next") as response:
            request_id = response.headers["Lambda-Runtime-Aws-Request-Id"]
            payload = json.loads(response.read())
        urllib.request.urlopen(
            urllib.request.Request(
                f"{self.base}/invocation/{request_id}/{outcome}", data=body
            )
        ).read()
        return payload

    def test_a_response_completes_the_invocation(self):
        seen = {}
        thread = threading.Thread(
            target=lambda: seen.update(payload=self.handler_round("response", b'{"a":1}'))
        )
        thread.start()
        self.assertEqual(self.invocations.invoke({"x": 1}), (True, {"a": 1}))
        thread.join()
        self.assertEqual(seen["payload"], {"x": 1})

    def test_an_error_reports_failure(self):
        thread = threading.Thread(target=lambda: self.handler_round("error"))
        thread.start()
        ok, _ = self.invocations.invoke({})
        thread.join()
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
