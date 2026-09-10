import unittest
from unittest.mock import patch, sentinel

import transcriber


class TranscriberConfigurationTest(unittest.TestCase):
    def test_configures_multilingual_deepgram_transcription(self):
        with (
            patch.object(
                transcriber.inference,
                "STT",
                return_value=sentinel.stt,
            ) as create_stt,
            patch.object(transcriber.Agent, "__init__", return_value=None) as init_agent,
        ):
            transcriber.Transcriber(
                participant_identity="participant-id",
                channel_id="channel-id",
                http_client=sentinel.http_client,
            )

        create_stt.assert_called_once()
        args, kwargs = create_stt.call_args
        self.assertEqual(args, ("deepgram/nova-3",))
        self.assertEqual(kwargs["language"], "multi")
        self.assertTrue(kwargs["extra_kwargs"]["diarize"])
        self.assertNotIn("detect_language", kwargs["extra_kwargs"])
        init_agent.assert_called_once_with(
            instructions="Transcribe user speech.",
            stt=sentinel.stt,
        )


if __name__ == "__main__":
    unittest.main()
