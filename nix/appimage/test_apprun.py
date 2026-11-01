"""Guard the narrow patch to the pinned native AppRun's environment table."""

import tempfile
import unittest
from pathlib import Path

from patch_apprun import IGNORED_VARIABLE, SCHEMA_VARIABLE, patch_apprun


class AppRunPatchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "original"
        self.output = Path(self.temp.name) / "patched"

    def test_preserves_size_source_and_surrounding_bytes(self):
        data = (
            b"\x7fELFprefix\0"
            + SCHEMA_VARIABLE
            + b"\0middle\0"
            + SCHEMA_VARIABLE
            + b"=%s/schemas/:%s\0suffix\0"
        )
        self.source.write_bytes(data)
        patch_apprun(self.source, self.output)
        self.assertEqual(self.source.read_bytes(), data)
        self.assertEqual(len(self.output.read_bytes()), len(data))
        self.assertEqual(
            self.output.read_bytes(),
            b"\x7fELFprefix\0"
            + IGNORED_VARIABLE
            + b"\0middle\0"
            + IGNORED_VARIABLE
            + b"=%s/schemas/:%s\0suffix\0",
        )
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o755)

    def test_rejects_missing_or_ambiguous_entries(self):
        for getters, setters in ((0, 1), (1, 0), (2, 1), (1, 2)):
            with self.subTest(getters=getters, setters=setters):
                self.source.write_bytes(
                    b"\x7fELF"
                    + (SCHEMA_VARIABLE + b"\0") * getters
                    + (SCHEMA_VARIABLE + b"=%s\0") * setters
                )
                with self.assertRaisesRegex(ValueError, "Unsupported AppRun"):
                    patch_apprun(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_rejects_non_elf_input(self):
        self.source.write_bytes(SCHEMA_VARIABLE)
        with self.assertRaisesRegex(ValueError, "Unsupported AppRun"):
            patch_apprun(self.source, self.output)
        self.assertFalse(self.output.exists())
