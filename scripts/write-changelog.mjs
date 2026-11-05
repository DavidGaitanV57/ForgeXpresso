import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "lib/changelog.generated.json";
const KEEP = 40;
// A bare "Merge branch 'main' …" says nothing to players. Deploy merges made with
// scripts/merge-to-deploy.mjs carry the merged changes as their message instead, so they pass.
const MERGE_TITLE = /^Merge (branch|remote-tracking branch|pull request|commit)\b/i;

function git(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const raw = git(`git log -${KEEP} --no-merges --pretty=format:%H%x1f%cI%x1f%s%x1f%b%x1e`);
const fresh = raw
  .split("\x1e")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((block) => {
    const [sha, date, title, body = ""] = block.split("\x1f");
    return {
      sha,
      date,
      title: title.replace(/\s+/g, " ").trim(),
      body: body
        .replace(/Co-Authored-By:.*$/gim, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500),
    };
  })
  .filter((e) => e.sha && e.date && e.title && !MERGE_TITLE.test(e.title));

// Hosts build from a one-commit clone: older entries come from the committed file.
let previous = [];
if (existsSync(OUT)) {
  try {
    previous = JSON.parse(readFileSync(OUT, "utf8")).entries || [];
  } catch {
    previous = [];
  }
}
const seen = new Set();
const entries = [...fresh, ...previous]
  .filter((e) => e && e.sha && !MERGE_TITLE.test(e.title || "") && !seen.has(e.sha) && seen.add(e.sha))
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  .slice(0, KEEP);

if (!entries.length && existsSync(OUT)) {
  console.log("[changelog] git log unavailable, keeping the existing file");
  process.exit(0);
}

const sha = git("git rev-parse HEAD") || entries[0]?.sha || "dev";
writeFileSync(OUT, JSON.stringify({ sha, builtAt: new Date().toISOString(), entries }, null, 2) + "\n");
console.log(`[changelog] ${entries.length} commits (${fresh.length} from git) @ ${sha.slice(0, 7)}`);
