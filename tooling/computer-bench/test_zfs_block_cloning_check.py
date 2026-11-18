import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("zfs-block-cloning-check.py")
SPEC = importlib.util.spec_from_file_location("zfs_block_cloning_check", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot import ZFS check")
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class FileModelTests(unittest.TestCase):
    def test_updates_are_isolated_between_clones(self) -> None:
        golden = b"A" * CHECK.CHUNK
        first = CHECK.FileModel(golden)
        second = CHECK.FileModel(golden)
        first.write(0, b"B" * CHECK.PAGE)
        self.assertEqual(first.chunk(0), b"B" * CHECK.PAGE + golden[CHECK.PAGE:])
        self.assertEqual(second.chunk(0), golden)

    def test_latest_write_replaces_the_previous_page(self) -> None:
        model = CHECK.FileModel(b"A" * CHECK.CHUNK)
        model.write(CHECK.PAGE, b"B" * CHECK.PAGE)
        model.write(CHECK.PAGE, b"C" * CHECK.PAGE)
        expected = b"A" * CHECK.PAGE + b"C" * CHECK.PAGE
        self.assertEqual(model.chunk(0), expected + b"A" * (CHECK.CHUNK - len(expected)))

    def test_verify_rejects_extra_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clone"
            golden = b"A" * CHECK.CHUNK
            path.write_bytes(golden + b"extra")
            with self.assertRaises(CHECK.CorruptionDetected):
                CHECK.verify(path, CHECK.FileModel(golden), "test")

    def test_self_test_changes_an_existing_ff_byte(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clone"
            golden = b"\xff" * CHECK.CHUNK
            path.write_bytes(golden)
            CHECK.flip_byte(path, 123)
            self.assertEqual(path.read_bytes()[123], 0)
            with self.assertRaises(CHECK.CorruptionDetected):
                CHECK.verify(path, CHECK.FileModel(golden), "test")

    def test_version_matching_includes_patch_release(self) -> None:
        self.assertEqual(CHECK.version_tuple("2.4.1-1ubuntu5.1"), (2, 4, 1))
        self.assertNotEqual(CHECK.version_tuple("2.4.0-1"), CHECK.version_tuple("2.4.1-1"))


if __name__ == "__main__":
    unittest.main()
