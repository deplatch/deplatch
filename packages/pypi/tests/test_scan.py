"""Tests for scan.py, toml.py, and cache.py."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from deplatch.toml import parse as parse_toml
from deplatch.scan import find_manifests


class TomlTests(unittest.TestCase):
    def test_basic_key_value(self):
        doc = parse_toml('name = "my-project"\nversion = "1.0.0"\ndebug = true\n')
        self.assertEqual(doc["name"], "my-project")
        self.assertEqual(doc["version"], "1.0.0")
        self.assertEqual(doc["debug"], True)

    def test_standard_tables(self):
        doc = parse_toml('[project]\nname = "foo"\n\n[project.optional-dependencies]\ndev = ["pytest", "black"]\n')
        self.assertEqual(doc["project"]["name"], "foo")
        self.assertIn("pytest", doc["project"]["optional-dependencies"]["dev"])
        self.assertIn("black", doc["project"]["optional-dependencies"]["dev"])

    def test_multiline_array(self):
        src = '[project]\ndependencies = [\n  "requests>=2.0",\n  "flask[async]>=3.0",\n  "numpy",\n]\n'
        doc = parse_toml(src)
        self.assertIn("requests>=2.0", doc["project"]["dependencies"])
        self.assertIn("flask[async]>=3.0", doc["project"]["dependencies"])

    def test_poetry_dependencies(self):
        src = '[tool.poetry.dependencies]\npython = "^3.9"\nrequests = "^2.28"\nclick = { version = "^8.0", optional = false }\n'
        doc = parse_toml(src)
        self.assertEqual(doc["tool"]["poetry"]["dependencies"]["requests"], "^2.28")
        self.assertIsInstance(doc["tool"]["poetry"]["dependencies"]["click"], dict)

    def test_pipfile_packages(self):
        src = '[packages]\nrequests = "*"\nflask = ">=2.0"\n\n[dev-packages]\npytest = "*"\n'
        doc = parse_toml(src)
        self.assertIn("requests", doc["packages"])
        self.assertIn("pytest", doc["dev-packages"])

    def test_comments_ignored(self):
        src = '# top\n[project]\nname = "foo"  # inline\n'
        doc = parse_toml(src)
        self.assertEqual(doc["project"]["name"], "foo")

    def test_single_and_double_quotes(self):
        src = "a = 'single'\nb = \"double\"\n"
        doc = parse_toml(src)
        self.assertEqual(doc["a"], "single")
        self.assertEqual(doc["b"], "double")

    def test_real_world_fastapi_style(self):
        src = """
[project]
name = "fastapi"
version = "0.110.0"
dependencies = [
    "starlette>=0.36.3,<0.37.0",
    "pydantic>=1.7.4",
    "typing-extensions>=4.8.0",
]

[project.optional-dependencies]
all = [
    "httpx>=0.23.0",
    "jinja2>=2.11.2",
]
"""
        doc = parse_toml(src)
        self.assertEqual(doc["project"]["name"], "fastapi")
        self.assertTrue(any(d.startswith("starlette") for d in doc["project"]["dependencies"]))
        self.assertTrue(any(d.startswith("httpx") for d in doc["project"]["optional-dependencies"]["all"]))

    def test_real_world_poetry_style(self):
        src = """
[tool.poetry]
name = "my-app"
version = "1.0.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.28"
pydantic = { version = "^2.0", extras = ["email"] }
"""
        doc = parse_toml(src)
        self.assertEqual(doc["tool"]["poetry"]["dependencies"]["requests"], "^2.28")
        self.assertIsInstance(doc["tool"]["poetry"]["dependencies"]["pydantic"], dict)


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.mkdtemp()
        self.root = Path(self.td)

    def _write(self, rel: str, content: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def _names(self, eco: str = None) -> list:
        targets = find_manifests(self.root)
        if eco:
            return [t["name"] for t in targets if t["ecosystem"] == eco]
        return [t["name"] for t in targets]

    # --- basic manifest detection ---

    def test_package_json(self):
        self._write("package.json", json.dumps({"dependencies": {"react": "^19", "lodash": "^4"}}))
        names = self._names("npm")
        self.assertIn("react", names)
        self.assertIn("lodash", names)

    def test_requirements_txt(self):
        self._write("requirements.txt", "requests==2.32\nflask>=3\n")
        names = self._names("pypi")
        self.assertIn("requests", names)
        self.assertIn("flask", names)

    def test_pyproject_toml_project_deps(self):
        self._write("pyproject.toml", '[project]\ndependencies = ["httpx>=0.23", "fastapi"]\n')
        names = self._names("pypi")
        self.assertIn("httpx", names)
        self.assertIn("fastapi", names)

    def test_pyproject_toml_poetry_deps(self):
        self._write("pyproject.toml", '[tool.poetry.dependencies]\npython = "^3.9"\nrequests = "^2.28"\n')
        names = self._names("pypi")
        self.assertIn("requests", names)
        self.assertNotIn("python", names)

    def test_pipfile(self):
        self._write("Pipfile", "[packages]\nrequests = \"*\"\n\n[dev-packages]\npytest = \"*\"\n")
        names = self._names("pypi")
        self.assertIn("requests", names)
        self.assertIn("pytest", names)

    # --- skip rules ---

    def test_node_modules_skipped(self):
        self._write("package.json", json.dumps({"dependencies": {"react": "^19"}}))
        self._write("node_modules/evil/package.json", json.dumps({"dependencies": {"malware": "^1"}}))
        self.assertNotIn("malware", self._names())
        self.assertIn("react", self._names())

    def test_git_skipped(self):
        self._write("requirements.txt", "requests\n")
        self._write(".git/hooks/requirements.txt", "evil-pkg\n")
        self.assertNotIn("evil-pkg", self._names())

    def test_venv_skipped(self):
        self._write("requirements.txt", "requests\n")
        self._write(".venv/requirements.txt", "evil-pkg\n")
        self._write("venv/requirements.txt", "another-evil\n")
        self.assertNotIn("evil-pkg", self._names())
        self.assertNotIn("another-evil", self._names())

    def test_dist_build_skipped(self):
        self._write("package.json", json.dumps({"dependencies": {"react": "^19"}}))
        self._write("dist/package.json", json.dumps({"dependencies": {"ghost": "^1"}}))
        self._write("build/package.json", json.dumps({"dependencies": {"ghost2": "^1"}}))
        self.assertNotIn("ghost", self._names())
        self.assertNotIn("ghost2", self._names())

    def test_gitignore_skips_matching_dirs(self):
        self._write(".gitignore", "generated\n*.egg-info\n")
        self._write("requirements.txt", "requests\n")
        self._write("generated/requirements.txt", "evil-pkg\n")
        self.assertNotIn("evil-pkg", self._names())
        self.assertIn("requests", self._names())

    # --- correctness properties ---

    def test_property_recursion_finds_nested_manifests(self):
        self._write("frontend/package.json", json.dumps({"dependencies": {"vue": "^3"}}))
        self._write("backend/requirements.txt", "django>=4\n")
        self.assertIn("vue", self._names())
        self.assertIn("django", self._names())

    def test_property_same_package_two_files_has_two_sources(self):
        self._write("requirements.txt", "requests\n")
        self._write("sub/requirements.txt", "requests\n")
        targets = find_manifests(self.root)
        req = [t for t in targets if t["name"] == "requests"]
        sources = {t["source"] for t in req}
        self.assertEqual(len(sources), 2)

    def test_property_non_registry_specs_skipped(self):
        self._write("package.json", json.dumps({
            "dependencies": {"react": "^19", "local": "file:../local", "gitpkg": "git+https://x/y.git"}
        }))
        names = self._names()
        self.assertIn("react", names)
        self.assertNotIn("local", names)
        self.assertNotIn("gitpkg", names)

    def test_property_all_packages_appear_in_output(self):
        """Every package found in a manifest appears in the output."""
        self._write("package.json", json.dumps({"dependencies": {"react": "^19", "lodash": "^4"}}))
        self._write("requirements.txt", "requests\nnumpy\n")
        targets = find_manifests(self.root)
        names = {t["name"] for t in targets}
        for expected in ("react", "lodash", "requests", "numpy"):
            self.assertIn(expected, names)

    def test_all_flag_includes_lockfile(self):
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {},
                "node_modules/react": {"version": "19.0.0", "resolved": "https://r.npm"},
                "node_modules/react-dom": {"version": "19.0.0", "resolved": "https://r.npm"},
            },
        }
        self._write("package-lock.json", json.dumps(lock))
        targets = find_manifests(self.root, all_deps=True)
        names = [t["name"] for t in targets]
        self.assertIn("react", names)
        self.assertIn("react-dom", names)

    def test_all_flag_false_skips_lockfile(self):
        lock = {"lockfileVersion": 3, "packages": {"node_modules/react": {"version": "19.0.0"}}}
        self._write("package-lock.json", json.dumps(lock))
        targets = find_manifests(self.root, all_deps=False)
        self.assertEqual(len(targets), 0)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.mkdtemp()

    def test_cache_warm_no_network_calls(self):
        """With a warm cache, no calls reach the base get_json."""
        from deplatch.cache import make_cached_get_json
        import time

        # Pre-populate cache
        cache_dir = Path(self.td) / ".deplatch"
        cache_dir.mkdir()
        ts = int(time.time())
        (cache_dir / "cache.json").write_text(json.dumps({
            "https://pypi.org/pypi/requests/json": {
                "ts": ts,
                "status": 200,
                "body": {"info": {"version": "2.32.0"}, "releases": {}},
            }
        }))

        calls = []

        def base(url):
            calls.append(url)
            return None

        cached = make_cached_get_json(base, self.td, fresh=False)
        result = cached("https://pypi.org/pypi/requests/json")
        self.assertEqual(calls, [], "cache hit should not call base")
        self.assertIsNotNone(result)

    def test_fresh_bypasses_cache(self):
        """--fresh causes the network to be called even with a warm cache."""
        from deplatch.cache import make_cached_get_json
        import time

        cache_dir = Path(self.td) / ".deplatch"
        cache_dir.mkdir()
        ts = int(time.time())
        (cache_dir / "cache.json").write_text(json.dumps({
            "https://pypi.org/pypi/requests/json": {
                "ts": ts,
                "status": 200,
                "body": {"info": {"version": "2.32.0"}, "releases": {}},
            }
        }))

        calls = []

        def base(url):
            calls.append(url)
            return {"info": {"version": "2.32.0"}, "releases": {}}

        cached = make_cached_get_json(base, self.td, fresh=True)
        cached("https://pypi.org/pypi/requests/json")
        self.assertEqual(len(calls), 1, "--fresh must call through")


if __name__ == "__main__":
    unittest.main()
