import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const OUT = "lib/changelog.generated.json";

function git(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const raw = git('git log -40 --no-merges --pretty=format:%H%x1f%cI%x1f%s%x1f%b%x1e');
const entries = raw
  .split("\x1e")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((block) => {
    const [sha, date, title, body = ""] = block.split("\x1f");
    return {
      sha,
      date,
      title: title.replace(/\s+/g, " ").trim(),
      body: body.replace(/\s+/g, " ").trim().slice(0, 500),
    };
  })
  .filter((e) => e.sha && e.date && e.title);

if (!entries.length && existsSync(OUT)) {
  console.log("[changelog] git log unavailable, keeping the existing file");
  process.exit(0);
}

const sha = git("git rev-parse HEAD") || entries[0]?.sha || "dev";
writeFileSync(OUT, JSON.stringify({ sha, builtAt: new Date().toISOString(), entries }, null, 2) + "\n");
console.log(`[changelog] ${entries.length} commits @ ${sha.slice(0, 7)}`);
