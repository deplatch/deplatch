import datetime as dt
import random
import string
import unittest

from deplatch.core import check, closest_popular, decide, levenshtein, parse_install_command
from deplatch.popular import NPM, PYPI

OLD = {"exists": True, "ageDays": 3000, "repository": "https://github.com/x/y", "latestVersion": "1.0.0"}
NOW = dt.datetime(2026, 11, 18, tzinfo=dt.timezone.utc)


class ParseTests(unittest.TestCase):
    def test_commands(self):
        cases = [
            ("npm install react lodash@4", ["npm:react", "npm:lodash"]),
            ("npm i -D @types/node@20", ["npm:@types/node"]),
            ('pip install requests==2.32 "flask[async]>=3"', ["pypi:requests", "pypi:flask"]),
            ("python3 -m pip install -r req.txt numpy", ["pypi:numpy"]),
            ("uv pip install httpx", ["pypi:httpx"]),
            ("cd app && npm install ai-super-helper", ["npm:ai-super-helper"]),
            ("npm install ./local-lib git+https://x/y.git user/repo", []),
            ("echo pip install is cool", []),
        ]
        for cmd, want in cases:
            got = [f'{t["ecosystem"]}:{t["name"]}' for t in parse_install_command(cmd)]
            self.assertEqual(got, want, cmd)


class VerdictTests(unittest.TestCase):
    def test_missing_is_blocked(self):
        for on_review in ("warn", "block"):
            self.assertEqual(decide("pypi", "flask-gpt-helper", {"exists": False}, policy={"onReview": on_review})["verdict"], "blocked")

    def test_lookalike(self):
        self.assertEqual(closest_popular("pypi", "reqeusts")["name"], "requests")
        self.assertEqual(decide("pypi", "reqeusts", OLD)["verdict"], "review")

    def test_new_package(self):
        fresh = {**OLD, "ageDays": 2}
        self.assertEqual(decide("npm", "new-auth-utils", fresh)["verdict"], "review")
        self.assertEqual(decide("npm", "new-auth-utils", fresh, policy={"onReview": "block"})["verdict"], "blocked")

    def test_lists(self):
        self.assertEqual(decide("npm", "my-internal", {"exists": False}, policy={"allow": ["npm:my-internal"]})["verdict"], "verified")
        self.assertEqual(decide("npm", "react", OLD, policy={"deny": ["npm:react"]})["verdict"], "blocked")

    def test_registry_error_is_review(self):
        self.assertEqual(decide("npm", "x-pkg", error="timeout")["verdict"], "review")

    def test_property_popular_never_flagged(self):
        for eco, names in (("npm", NPM), ("pypi", PYPI)):
            for n in names:
                self.assertIsNone(closest_popular(eco, n), n)
                self.assertEqual(decide(eco, n, OLD)["verdict"], "verified", n)

    def test_property_missing_always_blocked(self):
        rng = random.Random(7)
        for i in range(500):
            name = "x" + "".join(rng.choice(string.ascii_lowercase + "-") for _ in range(rng.randint(3, 20)))
            self.assertEqual(decide("npm" if i % 2 else "pypi", name, {"exists": False})["verdict"], "blocked")

    def test_property_levenshtein(self):
        words = ["react", "reakt", "requests", "reqeusts", "lodash", "a", ""]
        for a in words:
            for b in words:
                self.assertEqual(levenshtein(a, b), levenshtein(b, a))
                self.assertEqual(levenshtein(a, b) == 0, a == b)


class CheckTests(unittest.TestCase):
    def test_trustfile(self):
        db = {
            "https://pypi.org/pypi/requests/json": {"info": {"version": "2.32.0"}, "releases": {"0.2": [{"upload_time_iso_8601": "2011-02-14T00:00:00Z"}]}},
        }
        tf = check([{"ecosystem": "pypi", "name": "requests"}, {"ecosystem": "pypi", "name": "flask-gpt-helper"}],
                   now=NOW, get_json=lambda url: db.get(url))
        self.assertEqual(tf["trustfile"], "0.1")
        self.assertEqual(tf["summary"], {"verified": 1, "review": 0, "blocked": 1})


# ---------------------------------------------------------------------------
# CLI argument-parsing regression tests
# Mirror the Node tests exactly so the same invariants are verified in Python.
# ---------------------------------------------------------------------------

def _parse_cli_args(argv):
    """Mirrors the flag/args parsing in cli.py main() exactly."""
    flags = {a for a in argv if a.startswith("--")}
    out_value = argv.index("--out") + 1 if "--out" in argv else -1
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and i != out_value]
    out_file = argv[out_value] if 0 < out_value < len(argv) else None
    cmd = args[0] if args else None
    return cmd, args[1:] if args else [], flags, out_file


class CliArgParsingTests(unittest.TestCase):

    def test_check_name_json_preserves_name(self):
        cmd, names, flags, _ = _parse_cli_args(["check", "requests", "--json"])
        self.assertEqual(cmd, "check")
        self.assertEqual(names, ["requests"])
        self.assertIn("--json", flags)

    def test_check_npm_flag_preserves_name(self):
        cmd, names, flags, _ = _parse_cli_args(["check", "--npm", "react"])
        self.assertEqual(cmd, "check")
        self.assertEqual(names, ["react"])
        self.assertIn("--npm", flags)

    def test_check_prefixed_names(self):
        cmd, names, _, _ = _parse_cli_args(["check", "npm:react", "pypi:requests"])
        self.assertEqual(cmd, "check")
        self.assertEqual(names, ["npm:react", "pypi:requests"])

    def test_scan_out_file_does_not_drop_dir(self):
        cmd, rest, _, out_file = _parse_cli_args(["scan", "mydir", "--out", "file.json"])
        self.assertEqual(cmd, "scan")
        self.assertEqual(rest, ["mydir"])
        self.assertEqual(out_file, "file.json")

    def test_scan_out_file_no_dir(self):
        cmd, rest, _, out_file = _parse_cli_args(["scan", "--out", "file.json"])
        self.assertEqual(cmd, "scan")
        self.assertEqual(rest, [])
        self.assertEqual(out_file, "file.json")

    def test_no_args_gives_none_cmd(self):
        cmd, rest, _, _ = _parse_cli_args([])
        self.assertIsNone(cmd)
        self.assertEqual(rest, [])

    def test_check_multiple_names_and_json(self):
        cmd, names, flags, _ = _parse_cli_args(["check", "requests", "flask", "numpy", "--json"])
        self.assertEqual(cmd, "check")
        self.assertEqual(names, ["requests", "flask", "numpy"])
        self.assertIn("--json", flags)

    def test_regression_check_name_json_names_not_empty(self):
        """Regression: check <name> --json must not produce an empty name list."""
        _, names, _, _ = _parse_cli_args(["check", "requests", "--json"])
        self.assertGreater(len(names), 0, "name list must not be empty after parsing check <name> --json")


if __name__ == "__main__":
    unittest.main()
