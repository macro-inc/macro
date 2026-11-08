"""Offline target-checkout compatibility; no session, network or build access."""
import json
import posixpath
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import reconstruct

WORKSPACES = json.loads((Path(__file__).parent/'testdata/reconstruction-workspaces.json').read_text())


class TargetCheckout(unittest.TestCase):
    def workspace(self, path, tools, prompt, *, library=None):
        members = [tools, prompt]
        (path / 'Cargo.toml').write_text('[workspace]\nmembers = '+json.dumps(members)+'\n')
        for directory, name in [(tools, Path(tools).name), (prompt, Path(prompt).name)]:
            member = path / directory
            member.mkdir(parents=True)
            text = '[package]\nname = '+json.dumps(name)+'\nversion = "0.1.0"\n'
            if directory == tools and library:
                text += '[lib]\nname = '+json.dumps(library)+'\n'
            if directory == tools:
                prompt_path = posixpath.relpath(prompt, tools)
                text += '[dependencies]\nprompt = { package = '+json.dumps(Path(prompt).name)+', path = '+json.dumps(prompt_path)+' }\n'
            (member / 'Cargo.toml').write_text(text)

    def test_layouts_bind_target_library_and_cargo_package(self):
        for tools, prompt in [
            (WORKSPACES['old_tools'], WORKSPACES['old_prompt']),
            (WORKSPACES['grouped_tools'], WORKSPACES['grouped_prompt']),
            (WORKSPACES['current_tools'], WORKSPACES['current_prompt']),
        ]:
            with self.subTest(tools=tools), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.workspace(root, tools, prompt)
                packages = reconstruct.reconstruction_packages(root)
                target = reconstruct.prepare_example(root, packages)
                self.assertEqual(target, root / tools / 'examples/asv_reconstruct.rs')
                self.assertIn('extern crate '+Path(tools).name+' as reconstruction_tools;', target.read_text())
                self.assertIn('extern crate prompt as reconstruction_prompt;', target.read_text())
                self.assertIn('reconstruction_tools::tools_for_agent_code_mode()', target.read_text())
                self.assertNotIn('// TARGET_CHECKOUT_LIBRARY_ALIASES', target.read_text())
                with mock.patch.object(reconstruct, 'CACHE', root/'cache'), mock.patch.object(reconstruct, 'checkout', return_value=root), mock.patch.object(reconstruct.subprocess, 'run') as run:
                    run.side_effect = [mock.Mock(returncode=0, stdout='/nix/store/fixture-assets\n'), mock.Mock(returncode=0, stdout='{"docs": []}')]
                    self.assertEqual(reconstruct.render('fixture-sha', {'docs': []}), {'docs': []})
                    command = run.call_args_list[1].args[0]
                    self.assertEqual(command[command.index('-p')+1], Path(tools).name)
                    self.assertEqual(run.call_args_list[1].kwargs['cwd'], root)
                    self.assertEqual(json.loads(run.call_args_list[1].kwargs['input']), {'docs': []})
                    self.assertIn('CARGO_TARGET_DIR='+str(root/'cache/target/fixture-sha'), command)
                    # Same cache hit must perform no further external calls.
                    self.assertEqual(reconstruct.render('fixture-sha', {'docs': []}), {'docs': []})
                    self.assertEqual(run.call_count, 2)

    def test_declared_library_name_and_default_package_binding(self):
        for explicit in (None, 'prompt_api'):
            with self.subTest(explicit=explicit), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'], library='tools_api')
                manifest = root/WORKSPACES['old_prompt_manifest']
                text = manifest.read_text()
                # Package selection is prompt; its default library may be overridden.
                if explicit:
                    text += '[lib]\nname = "prompt_api"\n'
                manifest.write_text(text)
                packages = reconstruct.reconstruction_packages(root)
                self.assertEqual(packages['tools']['library'], 'tools_api')
                self.assertEqual(packages['prompt']['library'], 'prompt')

    def test_missing_and_ambiguous_members_fail_before_example_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            (root/WORKSPACES['old_tools_manifest']).write_text('[package]\nname = "other"\n')
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'exactly one tools.*found 0'):
                reconstruct.reconstruction_packages(root)
            (root/WORKSPACES['old_tools_manifest']).write_text('[package]\nname = "ai_tools"\n')
            extra = root/WORKSPACES['ambiguous_tools']
            extra.mkdir()
            (extra/'Cargo.toml').write_text('[package]\nname = "agent_tools"\n')
            (root/'Cargo.toml').write_text(WORKSPACES['wildcard_workspace'])
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'exactly one tools.*found 2'):
                reconstruct.reconstruction_packages(root)
            self.assertFalse((root/WORKSPACES['old_examples']).exists())

    def test_checkout_uses_target_members_instead_of_running_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            root = cache/'src/old-commit'
            root.mkdir(parents=True)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            with mock.patch.object(reconstruct, 'CACHE', cache), mock.patch.object(reconstruct.subprocess, 'run', side_effect=AssertionError('offline checkout must not fetch/build')):
                self.assertEqual(reconstruct.checkout('old-commit'), root)
            self.assertTrue((root/WORKSPACES['old_example']).is_file())
            self.assertFalse((root/WORKSPACES['current_tools']).exists())


    def test_excluded_and_nonmember_packages_cannot_make_a_target_ambiguous(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            extra = root/WORKSPACES['ambiguous_tools']
            extra.mkdir()
            (extra/'Cargo.toml').write_text('[package]\nname = "agent_tools"\n')
            self.assertEqual(reconstruct.reconstruction_packages(root)['tools']['package'], 'ai_tools')
            (root/'Cargo.toml').write_text(WORKSPACES['excluded_ambiguous_workspace'])
            self.assertEqual(reconstruct.reconstruction_packages(root)['tools']['package'], 'ai_tools')

    def test_missing_prompt_and_invalid_declared_library_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            manifest = root/WORKSPACES['old_prompt_manifest']
            text = manifest.read_text()
            manifest.write_text(text.replace('name = "prompt"', 'name = "unrelated"'))
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'exactly one prompt.*found 0'):
                reconstruct.reconstruction_packages(root)
            manifest.write_text(text+'[lib]\nname = "bad-library"\n')
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'invalid target library name'):
                reconstruct.reconstruction_packages(root)

    def test_implicit_members_follow_inherited_aliases_targets_and_cycles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'], library='tools_api')
            (root/'driver').mkdir()
            (root/'driver/Cargo.toml').write_text('[package]\nname = "driver"\n[target.\"cfg(unix)\".dependencies]\nold_alias = { workspace = true }\n')
            (root/'Cargo.toml').write_text(WORKSPACES['inherited_tools_workspace'])
            manifest = root/WORKSPACES['old_tools_manifest']
            manifest.write_text(manifest.read_text()+'driver = { path = "../../driver" }\n')
            packages = reconstruct.reconstruction_packages(root)
            self.assertEqual(packages['tools']['package'], 'ai_tools')
            self.assertEqual(packages['tools']['library'], 'tools_api')
            self.assertEqual(packages['prompt']['package'], 'prompt')
            (root/'Cargo.toml').write_text((root/'Cargo.toml').read_text().replace('members = ["driver"]', WORKSPACES['excluded_inherited_members']))
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'exactly one tools.*found 0'):
                reconstruct.reconstruction_packages(root)

    def test_malformed_and_missing_path_manifests_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            manifest = root/WORKSPACES['old_tools_manifest']
            text = manifest.read_text()
            manifest.write_text(text+'missing = { path = "../missing" }\n')
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'missing target path dependency manifest'):
                reconstruct.reconstruction_packages(root)
            manifest.write_text('invalid = [')
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'cannot read target manifest'):
                reconstruct.reconstruction_packages(root)

    def test_prompt_library_and_inherited_dependency_alias_bind_visible_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.workspace(root, WORKSPACES['old_tools'], WORKSPACES['old_prompt'])
            prompt = root/WORKSPACES['old_prompt_manifest']
            prompt.write_text(prompt.read_text()+'[lib]\nname = "prompt_library"\n')
            tools = root/WORKSPACES['old_tools_manifest']
            text = tools.read_text()
            tools.write_text(text.replace('prompt = { package = "prompt", path = "../prompt" }', 'prompt = { path = "../prompt" }'))
            self.assertEqual(reconstruct.reconstruction_packages(root)['prompt']['library'], 'prompt_library')
            workspace = root/'Cargo.toml'
            workspace.write_text(workspace.read_text()+WORKSPACES['inherited_prompt_dependency'])
            tools.write_text(text.replace('prompt = { package = "prompt", path = "../prompt" }', 'historical-prompt = { workspace = true }'))
            packages = reconstruct.reconstruction_packages(root)
            self.assertEqual(packages['prompt']['library'], 'historical_prompt')
            target = reconstruct.prepare_example(root, packages)
            self.assertIn('extern crate historical_prompt as reconstruction_prompt;', target.read_text())
            tools.write_text(tools.read_text()+'other_prompt = { package = "prompt", path = "../prompt" }\n')
            with self.assertRaisesRegex(reconstruct.ReconstructionFailed, 'exactly one visible prompt dependency.*found 2'):
                reconstruct.reconstruction_packages(root)
