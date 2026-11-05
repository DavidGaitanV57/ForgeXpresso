/**
 * Merges main into the deploy branch with a message that describes the changes it brings,
 * so "What's new" on the host (which builds from a one-commit clone) shows them instead of "Merge branch …".
 * Run it from a checkout of the deploy branch:  node scripts/merge-to-deploy.mjs [source=origin/main]
 * Then push that branch.
 */
import { execFileSync } from "node:child_process";

const source = process.argv[2] || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const log = git("log", "--no-merges", "--pretty=format:%s%x1f%b%x1e", `HEAD..${source}`);
const changes = log
  .split("\x1e")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [title, body = ""] = s.split("\x1f");
    return { title: title.trim(), body: body.replace(/Co-Authored-By:.*$/gim, "").trim() };
  });

if (!changes.length) {
  console.log(`[deploy] nothing new in ${source}`);
  process.exit(0);
}

// Newest change is the headline; its own description and the other changes go in the body.
const [top, ...rest] = changes;
const body = [top.body, rest.length ? `Also in this deploy:\n${rest.map((c) => `- ${c.title}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
execFileSync("git", ["merge", "--no-ff", "--no-edit", "-m", top.title, ...(body ? ["-m", body] : []), source], { stdio: "inherit" });
console.log(`[deploy] merged ${changes.length} change(s): ${top.title}`);
