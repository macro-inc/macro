"""Small real-ELF regression fixtures; no frontend or Rust build required."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ldd import dependencies
from relocate import patchelf, relocate


class PackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lib = self.root / "build/lib"
        self.lib.mkdir(parents=True)
        self.appdir = self.root / "Macro.AppDir"
        self.bundle_lib = self.appdir / "usr/lib"
        self.bundle_lib.mkdir(parents=True)
        (self.appdir / "usr/bin").mkdir()
        self.environment = patch.dict(os.environ, {"LD_LIBRARY_PATH": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.second = self.compile(
            "libsecond.so.2.3", "int second(void) { return 0; }", []
        )
        patchelf(self.second, "--set-soname", "libsecond.so.2")
        self.alias = self.lib / "libsecond.so.2"
        self.alias.symlink_to(self.second.name)
        self.first = self.compile(
            "libfirst.so.1.2",
            "extern int second(void); int first(void) { return second(); }",
            [str(self.alias)],
        )
        patchelf(self.first, "--set-soname", "libfirst.so.1")
        self.app = self.compile(
            "app",
            "extern int first(void); void _start(void) { first(); }",
            [str(self.first)],
        )
        (self.lib / "libfirst.so.1").symlink_to(self.first.name)

    def compile(self, name, source, libraries):
        output = self.lib / name
        link_mode = [] if name == "app" else ["-shared"]
        subprocess.run(
            [
                os.environ.get("CC", "cc"),
                *link_mode,
                "-fPIC",
                "-nostdlib",
                "-x",
                "c",
                "-",
                "-x",
                "none",
                *libraries,
                f"-Wl,-rpath,{self.lib}",
                "-o",
                str(output),
            ],
            input=source,
            text=True,
            check=True,
        )
        return output

    def populate(self):
        for path in (self.first, self.second):
            shutil.copy2(path, self.bundle_lib / path.name)
        shutil.copy2(self.app, self.appdir / "usr/bin/app")

    def test_ldd_includes_transitive_dependencies_and_keeps_aliases(self):
        result = dependencies(self.app)
        self.assertEqual(set(result), {"libfirst.so.1", "libsecond.so.2"})
        self.assertEqual(result["libsecond.so.2"], self.alias)

    def test_ldd_rejects_missing_transitive_dependency(self):
        self.alias.unlink()
        with self.assertRaisesRegex(RuntimeError, "libsecond.so.2 => not found"):
            dependencies(self.app)

    def test_ldd_handles_cycles(self):
        patchelf(self.second, "--add-needed", "libfirst.so.1")
        self.assertEqual(len(dependencies(self.app)), 2)

    def test_ldd_reuses_first_loaded_soname(self):
        alternate = self.root / "alternate"
        alternate.mkdir()
        shutil.copy2(self.second, alternate / "libsecond.so.2")
        patchelf(self.first, "--set-rpath", str(alternate))
        patchelf(self.app, "--add-needed", "libsecond.so.2")
        result = dependencies(self.app)
        self.assertEqual(result["libsecond.so.2"], self.alias)

    def test_relocation_restores_sonames_and_origin_paths(self):
        self.populate()
        relocate(self.appdir)
        self.assertEqual(
            (self.bundle_lib / "libsecond.so.2").readlink(), Path(self.second.name)
        )
        binary = self.appdir / "usr/bin/app"
        self.assertEqual(patchelf(binary, "--print-rpath"), "$ORIGIN:$ORIGIN/../lib")
        self.assertEqual(
            patchelf(self.bundle_lib / self.first.name, "--print-rpath"), "$ORIGIN"
        )
        self.assertEqual(len(dependencies(binary)), 2)
        relocate(self.appdir)  # Idempotent; never create links to links.

    def test_relocation_rewrites_absolute_needed(self):
        self.populate()
        binary = self.appdir / "usr/bin/app"
        absolute = "/nix/store/fixture/lib/libfirst.so.1"
        patchelf(binary, "--replace-needed", "libfirst.so.1", absolute)
        relocate(self.appdir)
        self.assertEqual(patchelf(binary, "--print-needed"), "libfirst.so.1")

    def test_relocation_rejects_unbundled_absolute_needed(self):
        self.populate()
        binary = self.appdir / "usr/bin/app"
        patchelf(binary, "--add-needed", "/nix/store/fixture/lib/libmissing.so.1")
        with self.assertRaisesRegex(RuntimeError, "unbundled absolute dependency"):
            relocate(self.appdir)

    def test_relocation_rewrites_interpreter_and_shebang(self):
        self.populate()
        binary = self.appdir / "usr/bin/app"
        patchelf(
            binary, "--set-interpreter", "/nix/store/fixture/lib/ld-linux-x86-64.so.2"
        )
        script = self.appdir / "usr/bin/xdg-open"
        script.write_text("#!/nix/store/fixture/bin/sh\necho ok\n")
        relocate(self.appdir)
        self.assertEqual(
            patchelf(binary, "--print-interpreter"), "/lib64/ld-linux-x86-64.so.2"
        )
        self.assertEqual(script.read_text(), "#!/usr/bin/env sh\necho ok\n")

    def test_relocation_handles_read_only_nix_copies(self):
        self.populate()
        for path in self.bundle_lib.iterdir():
            path.chmod(0o555)
        script = self.appdir / "usr/bin/xdg-open"
        script.write_text("#!/nix/store/fixture/bin/sh\necho ok\n")
        script.chmod(0o555)
        relocate(self.appdir)
        self.assertEqual(
            patchelf(self.bundle_lib / self.first.name, "--print-rpath"), "$ORIGIN"
        )
        self.assertTrue(script.read_text().startswith("#!/usr/bin/env sh\n"))

    def test_relocation_rewrites_release_webkit_helper_directory(self):
        self.populate()
        prefix = b"/nix/store/fixture/libexec/webkit2gtk-4.1"
        webkit = self.compile(
            "libwebkit2gtk-4.1.so.0",
            f'const char helper_directory[] = "{prefix.decode()}";',
            [],
        )
        bundled = self.bundle_lib / webkit.name
        shutil.copy2(webkit, bundled)
        relocate(self.appdir)
        self.assertNotIn(prefix, bundled.read_bytes())
        self.assertIn(b"./bin\x00", bundled.read_bytes())
        self.assertEqual(patchelf(bundled, "--print-rpath"), "$ORIGIN")
        before = bundled.read_bytes()
        relocate(self.appdir)
        self.assertEqual(bundled.read_bytes(), before)

    def test_relocation_rejects_nix_only_proxy_schema_paths(self):
        self.populate()
        for name in ("libpxbackend-1.0.so", "libgiognomeproxy.so"):
            with self.subTest(library=name):
                source = self.compile(
                    name,
                    'const char schema_dir[] = "/nix/store/fixture-gsettings-desktop-schemas/share/glib-2.0/schemas";',
                    [],
                )
                bundled = self.bundle_lib / name
                shutil.copy2(source, bundled)
                with self.assertRaisesRegex(RuntimeError, "Nix-only GSettings"):
                    relocate(self.appdir)
                bundled.unlink()

    def test_relocation_rejects_conflicting_sonames(self):
        self.populate()
        conflicting = self.bundle_lib / "conflicting.so"
        shutil.copy2(self.first, conflicting)
        with self.assertRaisesRegex(RuntimeError, "conflicting SONAME"):
            relocate(self.appdir)


if __name__ == "__main__":
    unittest.main()
