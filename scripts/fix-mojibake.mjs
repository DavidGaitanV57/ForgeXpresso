import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/fix-mojibake.mjs <project.json>");
  process.exit(1);
}

let raw = fs.readFileSync(path, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const j = JSON.parse(raw);

/** UTF-8 interpreted as Windows-1252 / Latin-1, then sometimes further mangled. */
function fixStr(s) {
  if (typeof s !== "string") return s;

  // Round-trip latin1→utf8 when classic Ã / Â / â patterns remain.
  if (/Ã.|Â.|â./.test(s)) {
    const once = Buffer.from(s, "latin1").toString("utf8");
    if (!once.includes("\uFFFD") || s.includes("\uFFFD")) s = once;
  }

  // Arrow / punctuation leftovers when 0x86 etc. were remapped to Unicode † etc.
  const map = [
    [/â\u2020\u0090|â†\u0090|â†|Ã¢â€\u0090/g, "\u2190"], // ←
    [/â\u2020\u2019|â†’|Ã¢â€\u2122/g, "\u2192"], // →
    [/â\u2020\u2018|â†‘|Ã¢â€\u02C6/g, "\u2191"], // ↑
    [/â\u2020\u201C|â†“|Ã¢â€\u0153/g, "\u2193"], // ↓
    [/â\u2020\u0093|â€“/g, "\u2013"], // –
    [/â\u2020\u0094|â€”/g, "\u2014"], // —
    [/â\u2020\u00A2|â€¢/g, "\u2022"], // •
    [/â\u2020\u00A6|â€¦/g, "\u2026"], // …
    [/Â¡/g, "¡"],
    [/Â¿/g, "¿"],
  ];
  for (const [re, rep] of map) s = s.replace(re, rep);

  // Explicit broken sequences seen in this project (console-safe via code points).
  s = s
    .replace(/\u00E2\u2020\u0090/g, "\u2190")
    .replace(/\u00E2\u2020\u2019/g, "\u2192")
    .replace(/\u00E2\u2020\u2018/g, "\u2191")
    .replace(/\u00E2\u2020\u201C/g, "\u2193")
    .replace(/\u00E2\u2020\u2190/g, "\u2190")
    .replace(/\u00E2\u2020\u2192/g, "\u2192")
    .replace(/\u00E2\u2020\u2191/g, "\u2191")
    .replace(/\u00E2\u2020\u2193/g, "\u2193")
    .replace(/\u00E2\u2020\u00E0/g, "\u2190") // â†à sometimes
    .replace(/\u00E2\u2020 /g, "\u2190 "); // "â† " before next

  // Final pass: if still looks like "â†" + one char for each arrow slot
  s = s.replace(/\u00E2\u2020([^\s/])/g, (_, ch) => {
    const cp = ch.codePointAt(0);
    // Heuristic leftovers of ←→↑↓ after dagger remap
    if (cp === 0x2190 || cp === 0x90 || cp === 0xe0) return "\u2190";
    if (cp === 0x2192 || cp === 0x2019) return "\u2192";
    if (cp === 0x2191 || cp === 0x2018) return "\u2191";
    if (cp === 0x2193 || cp === 0x201c) return "\u2193";
    return "\u00E2\u2020" + ch;
  });

  return s;
}

function walk(v) {
  if (typeof v === "string") return fixStr(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) v[k] = walk(v[k]);
  }
  return v;
}

walk(j);
fs.writeFileSync(path, JSON.stringify(j, null, 2), { encoding: "utf8" });

const c0 = j.design?.controls?.[0]?.input;
console.log("title:", j.design?.title);
console.log("tagline:", j.design?.tagline);
console.log("controls:", c0);
console.log(
  "control cps:",
  c0 ? [...c0].map((c) => c.codePointAt(0).toString(16)).join(" ") : "-",
);
console.log("cine2:", j.design?.cinematic?.lines?.[2]);
