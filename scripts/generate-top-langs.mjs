#!/usr/bin/env node
// Self-contained top-languages SVG generator.
//
// Talks directly to the GitHub REST API (no third-party rendering service),
// so this card can never go down because someone else's Vercel deployment did.
// Uses only Node's built-in fetch — no npm dependencies to install/audit.

const USERNAME = process.env.GH_USERNAME || "waleed-zaheer";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUT_FILE = process.env.OUT_FILE || "assets/top-langs.svg";
const TOP_N = 6;

const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Shell: "#89e051",
  Vue: "#41b883",
  Dockerfile: "#384d54",
  EJS: "#a91e50",
  Handlebars: "#f7931e",
};
const DEFAULT_COLOR = "#8b949e";

function headers() {
  const h = {
    "User-Agent": `${USERNAME}-readme-stats`,
    Accept: "application/vnd.github+json",
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function ghFetch(url) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}`);
  }
  return res.json();
}

async function getOwnedRepos(username) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner`
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((r) => !r.fork && !r.archived);
}

async function getLanguageBytes(owner, repo) {
  return ghFetch(`https://api.github.com/repos/${owner}/${repo}/languages`);
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c])
  );
}

function buildSvg(languages) {
  const width = 300;
  const padding = 25;
  const barHeight = 8;
  const barY = 58;
  const rowHeight = 24;
  const cols = 2;
  const colWidth = (width - padding * 2) / cols;
  const rows = Math.ceil(languages.length / cols);
  const legendY = barY + barHeight + 20;
  const height = legendY + rows * rowHeight + 10;

  let barSegments = "";
  let x = padding;
  const barWidth = width - padding * 2;
  for (const lang of languages) {
    const segWidth = (lang.pct / 100) * barWidth;
    barSegments += `<rect x="${x.toFixed(2)}" y="${barY}" width="${segWidth.toFixed(
      2
    )}" height="${barHeight}" fill="${lang.color}" />\n`;
    x += segWidth;
  }

  let legendItems = "";
  languages.forEach((lang, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lx = padding + col * colWidth;
    const ly = legendY + row * rowHeight;
    legendItems += `
      <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${lang.color}" />
      <text x="${lx + 16}" y="${ly}" font-size="12" fill="#a9b1d6" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(
      lang.name
    )} ${lang.pct.toFixed(1)}%</text>`;
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
  </style>
  <rect x="0.5" y="0.5" rx="4.5" width="${width - 1}" height="${height - 1}" fill="#1a1b27" stroke="#414868" stroke-opacity="1" />
  <text x="${padding}" y="35" class="title">Most Used Languages</text>
  <g>${barSegments}</g>
  <g>${legendItems}</g>
</svg>`;
}

async function main() {
  const repos = await getOwnedRepos(USERNAME);
  const totals = {};

  for (const repo of repos) {
    let bytes;
    try {
      bytes = await getLanguageBytes(USERNAME, repo.name);
    } catch (err) {
      console.warn(`skip ${repo.name}: ${err.message}`);
      continue;
    }
    for (const [lang, count] of Object.entries(bytes)) {
      totals[lang] = (totals[lang] || 0) + count;
    }
  }

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) {
    throw new Error("no language data found across repos");
  }

  const languages = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name, bytes]) => ({
      name,
      pct: (bytes / grandTotal) * 100,
      color: LANG_COLORS[name] || DEFAULT_COLOR,
    }));

  const svg = buildSvg(languages);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, svg, "utf8");
  console.log(`wrote ${OUT_FILE} (${languages.length} languages, ${repos.length} repos scanned)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
