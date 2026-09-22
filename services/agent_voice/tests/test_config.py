import unittest

from config import VoiceConfigurationError, connection_options, requires_credentials, worker_name


def configured_environment():
    return {
        "OPENAI_API_KEY": "sk-offline-contract-fixture",
        "LIVEKIT_API_KEY": "offline-contract-key",
        "LIVEKIT_API_SECRET": "offline-contract-secret",
        "LIVEKIT_SERVER_URL": "https://macro.invalid/",
    }


class ConfigurationTests(unittest.TestCase):
    def test_worker_names_match_the_backend_scope(self):
        for environment, expected in (
            ({}, "macro-agent-voice-prod"),
            ({"ENVIRONMENT": "prod"}, "macro-agent-voice-prod"),
            ({"ENVIRONMENT": "dev", "COMPOSE_PROJECT_NAME": "ignored-local-project"}, "macro-agent-voice-dev"),
            ({"ENVIRONMENT": "local"}, "macro-agent-voice-local-macro"),
            ({"ENVIRONMENT": "local", "COMPOSE_PROJECT_NAME": "macro-voice-test"}, "macro-agent-voice-local-macro-voice-test"),
        ):
            with self.subTest(environment=environment):
                self.assertEqual(worker_name(environment), expected)
        self.assertNotEqual(
            worker_name({"ENVIRONMENT": "local", "COMPOSE_PROJECT_NAME": "macro-one"}),
            worker_name({"ENVIRONMENT": "local", "COMPOSE_PROJECT_NAME": "macro-two"}),
        )

    def test_shared_server_url_maps_to_sdk_websocket_url(self):
        environment = configured_environment()
        result = connection_options(environment, required=True)
        self.assertEqual(result["ws_url"], "wss://macro.invalid/")
        self.assertEqual(result["api_key"], environment["LIVEKIT_API_KEY"])
        self.assertNotIn("LIVEKIT_URL", environment)

    def test_explicit_worker_url_wins_over_shared_url(self):
        environment = configured_environment() | {"LIVEKIT_URL": "ws://localhost:22031"}
        self.assertEqual(connection_options(environment, required=True)["ws_url"], "ws://localhost:22031")

    def test_missing_and_placeholder_credentials_fail_before_worker_start(self):
        for name in ("OPENAI_API_KEY", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
            for value in ("", "local-stub", "your-api-key", "changeme", "${UNRESOLVED}"):
                with self.subTest(name=name, value=value), self.assertRaises(VoiceConfigurationError) as error:
                    connection_options(configured_environment() | {name: value}, required=True)
                self.assertIn(name, str(error.exception))
                if value:
                    self.assertNotIn(value, str(error.exception))

    def test_invalid_url_error_never_echoes_credential_bearing_url(self):
        environment = configured_environment() | {"LIVEKIT_URL": "https://user:secret@macro.invalid"}
        with self.assertRaises(VoiceConfigurationError) as error:
            connection_options(environment, required=True)
        self.assertNotIn("secret", str(error.exception))
        self.assertNotIn("user", str(error.exception))

    def test_download_files_help_and_imports_work_without_configuration(self):
        self.assertEqual(connection_options({}, required=False), {"ws_url": None, "api_key": None, "api_secret": None})
        for arguments in ([], ["download-files"], ["--help"], ["start", "--help"]):
            self.assertFalse(requires_credentials(arguments))
        for arguments in (["start"], ["dev"], ["connect", "--room", "example"]):
            self.assertTrue(requires_credentials(arguments))


if __name__ == "__main__":
    unittest.main()
