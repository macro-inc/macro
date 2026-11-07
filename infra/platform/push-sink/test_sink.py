import re
import unittest

from sink import Sink, parse_attributes


def arn_of(xml):
    return re.search(r"<EndpointArn>(.*)</EndpointArn>", xml).group(1)


class PushSink(unittest.TestCase):
    def setUp(self):
        self.sink = Sink()

    def create(self, token="device"):
        status, xml = self.sink.handle(
            {
                "Action": "CreatePlatformEndpoint",
                "PlatformApplicationArn": "arn:aws:sns:us-east-1:0:app/APNS/macro",
                "Token": token,
            }
        )
        self.assertEqual(status, 200)
        return arn_of(xml)

    def test_a_token_keeps_its_endpoint(self):
        self.assertEqual(self.create(), self.create())
        self.assertNotEqual(self.create("a"), self.create("b"))

    def test_endpoint_attributes_round_trip(self):
        arn = self.create()
        status, _ = self.sink.handle(
            {
                "Action": "SetEndpointAttributes",
                "EndpointArn": arn,
                "Attributes.entry.1.key": "Enabled",
                "Attributes.entry.1.value": "false",
            }
        )
        self.assertEqual(status, 200)
        _, xml = self.sink.handle({"Action": "GetEndpointAttributes", "EndpointArn": arn})
        self.assertIn("<key>Enabled</key><value>false</value>", xml)
        self.assertIn("<key>Token</key><value>device</value>", xml)

    def test_a_deleted_endpoint_is_gone(self):
        arn = self.create()
        self.assertEqual(self.sink.handle({"Action": "DeleteEndpoint", "EndpointArn": arn})[0], 200)
        status, xml = self.sink.handle({"Action": "GetEndpointAttributes", "EndpointArn": arn})
        self.assertEqual(status, 404)
        self.assertIn("<Code>NotFound</Code>", xml)

    def test_a_publish_is_counted_and_sends_nothing(self):
        status, xml = self.sink.handle(
            {"Action": "Publish", "TargetArn": self.create(), "Message": "hello"}
        )
        self.assertEqual(status, 200)
        self.assertIn("<MessageId>", xml)
        self.assertEqual(self.sink.published, 1)

    def test_values_are_escaped(self):
        arn = self.create("a<b&c")
        _, xml = self.sink.handle({"Action": "GetEndpointAttributes", "EndpointArn": arn})
        self.assertIn("a&lt;b&amp;c", xml)

    def test_an_unknown_action_is_an_error(self):
        status, xml = self.sink.handle({"Action": "Subscribe"})
        self.assertEqual(status, 400)
        self.assertIn("InvalidAction", xml)

    def test_attributes_parse_in_order(self):
        self.assertEqual(
            parse_attributes(
                {
                    "Attributes.entry.1.key": "A",
                    "Attributes.entry.1.value": "1",
                    "Attributes.entry.2.key": "B",
                    "Attributes.entry.2.value": "2",
                }
            ),
            {"A": "1", "B": "2"},
        )


if __name__ == "__main__":
    unittest.main()
