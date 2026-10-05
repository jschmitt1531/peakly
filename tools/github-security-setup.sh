#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Peakly-Free-Use-1.0
# One-time GitHub hardening for jschmitt1531/peakly. Run AFTER the repository is made public
# (several features are only free for public repos). Needs the GitHub CLI logged in as an admin: gh auth status
# Usage: tools/github-security-setup.sh [owner/repo]
set -uo pipefail
R="${1:-jschmitt1531/peakly}"
ok()   { echo "  ✓ $1"; }
warn() { echo "  ✗ $1"; }
run()  { local label="$1"; shift; if out=$("$@" 2>&1); then ok "$label"; else warn "$label: $(echo "$out" | head -1)"; fi; }

vis=$(gh api "repos/$R" --jq .visibility) || { echo "Cannot read $R"; exit 1; }
echo "Repository $R is $vis"
[ "$vis" = public ] || echo "  (private: rulesets, private vulnerability reporting, secret scanning and Pages need the repo to be public)"

echo "Vulnerability alerts and fixes"
run "Dependabot alerts"              gh api -X PUT "repos/$R/vulnerability-alerts"
run "Dependabot security updates"    gh api -X PUT "repos/$R/automated-security-fixes"
run "Private vulnerability reporting" gh api -X PUT "repos/$R/private-vulnerability-reporting"

echo "Secret scanning"
run "Secret scanning + push protection" gh api -X PATCH "repos/$R" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON

echo "Actions"
run "Default workflow token read-only, cannot approve PRs" gh api -X PUT "repos/$R/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "Branch protection (ruleset on the default branch)"
if gh api "repos/$R/rulesets" --jq '.[].name' 2>/dev/null | grep -qx "Protect main"; then ok "ruleset already exists"; else
run "Ruleset: no deletion, no force-push, PRs + passing tests required" gh api -X POST "repos/$R/rulesets" --input - <<'JSON'
{"name":"Protect main","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,"required_status_checks":[{"context":"test"}]}}]}
JSON
fi
echo "  (repo admins can bypass, so a single maintainer can still push hotfixes; remove bypass_actors once there are 2+ maintainers)"

echo "Community features"
run "Discussions on"            gh api -X PATCH "repos/$R" -F has_discussions=true
run "Wiki off (docs live in the repo)" gh api -X PATCH "repos/$R" -F has_wiki=false

echo "GitHub Pages (source: GitHub Actions)"
if gh api "repos/$R/pages" >/dev/null 2>&1; then ok "Pages already enabled"; else
run "Pages enabled" gh api -X POST "repos/$R/pages" -f build_type=workflow; fi
run "Pages HTTPS enforced" gh api -X PUT "repos/$R/pages" -F https_enforced=true

echo "Done. Re-run any time; it is idempotent. Review: https://github.com/$R/settings/security_analysis"
