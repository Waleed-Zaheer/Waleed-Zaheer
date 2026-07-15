/**
 * Injects hover tooltips into assets/activity-graph.svg.
 *
 * The activity graph fetched from github-readme-activity-graph.vercel.app
 * renders one Chartist point per day (<line class="ct-point" ct:value="N">)
 * with no hover affordance. This script adds, per point:
 *   1. a native <title> ("N contributions · Mon D, YYYY") — the browser's
 *      built-in delayed tooltip, zero-dependency fallback, and
 *   2. a styled tooltip box (<g class="pt-tip">) that appears instantly on
 *      hover via CSS sibling pairing (.ct-point:nth-of-type(i):hover ~
 *      .pt-tip:nth-of-type(i)), GitHub-contribution-calendar style.
 *
 * Tooltips only work where the SVG is rendered as a real document (the raw
 * file URL, a local browser tab, an inline embed on a website). GitHub
 * READMEs display images through <img>, which browsers render statically —
 * no hover is possible there; that is a platform restriction, not something
 * this script can change. The README links to the raw URL for the
 * interactive version.
 *
 * Dates: the graph's x-axis labels are bare day-of-month numbers covering
 * the last 31 days. The full dates are reconstructed by scanning backwards
 * from today for an end date whose 31-day walk matches every label —
 * robust to the SVG being a day or two stale when this runs.
 *
 * Idempotent: previously injected titles, tip groups, and tip CSS are
 * stripped before re-inserting.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SVG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "activity-graph.svg");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// tokyo-night to match the graph's pinned theme
const TIP_BG = "#16161e";
const TIP_BORDER = "#3b4261";
const TIP_TEXT = "#c0caf5";

let svg = readFileSync(SVG_PATH, "utf8");

// Strip everything a previous run injected.
svg = svg.replace(/(<line[^>]*class="ct-point"[^>]*>)<title>[^<]*<\/title>/g, "$1");
svg = svg.replace(/<g class="pt-tip">.*?<\/g>/gs, "");
svg = svg.replace(/\/\*pt-tips\*\/.*?\/\*end-pt-tips\*\//gs, "");

// X-axis labels, in order — bare day-of-month numbers.
const labels = [...svg.matchAll(/class="ct-label ct-horizontal ct-end"[^>]*>(\d+)</g)].map((m) => Number(m[1]));

// Points, in the same order, with coordinates and values.
const points = [...svg.matchAll(/<line[^>]*class="ct-point"[^>]*>/g)].map((m) => {
  const attr = (name) => {
    const found = m[0].match(new RegExp(`${name}="([^"]+)"`));
    return found ? found[1] : null;
  };
  return { tag: m[0], x: Number(attr("x1")), y: Number(attr("y1")), value: Number(attr("ct:value")) };
});

if (labels.length === 0 || labels.length !== points.length) {
  console.error(`label/point mismatch (labels=${labels.length}, points=${points.length}) — leaving SVG untouched`);
  process.exit(1);
}

// Find the end date: today or up to 14 days back, whichever makes every
// label's day-of-month line up when walking one day per point.
function findEndDate() {
  const today = new Date();
  for (let back = 0; back <= 14; back++) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const ok = labels.every((label, i) => {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - (labels.length - 1 - i));
      return d.getUTCDate() === label;
    });
    if (ok) return end;
  }
  return null;
}

const endDate = findEndDate();
if (!endDate) {
  console.error("could not anchor labels to real dates — leaving SVG untouched");
  process.exit(1);
}

const tipText = (point, i) => {
  const d = new Date(endDate);
  d.setUTCDate(d.getUTCDate() - (labels.length - 1 - i));
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return `${point.value} contribution${point.value === 1 ? "" : "s"} · ${date}`;
};

// 1. Native <title> per point.
let index = 0;
svg = svg.replace(/(<line[^>]*class="ct-point"[^>]*>)/g, (whole) => `${whole}<title>${tipText(points[index], index++)}</title>`);

// 2. Styled tooltip boxes, appended after the last point so they always
//    paint above the dots and the line.
const VIEW_W = 1200;
const tips = points
  .map((p, i) => {
    const text = tipText(p, i);
    const w = Math.round(text.length * 6.8) + 24;
    const h = 26;
    const cx = Math.min(Math.max(p.x, w / 2 + 6), VIEW_W - w / 2 - 6);
    const above = p.y >= 80 + h + 18;
    const rectY = above ? p.y - 14 - h : p.y + 14;
    return (
      `<g class="pt-tip">` +
      `<rect x="${(cx - w / 2).toFixed(1)}" y="${rectY}" width="${w}" height="${h}" rx="6" fill="${TIP_BG}" stroke="${TIP_BORDER}"/>` +
      `<text x="${cx.toFixed(1)}" y="${rectY + h / 2 + 4}" text-anchor="middle">${text}</text>` +
      `</g>`
    );
  })
  .join("");

const lastPointEnd = svg.lastIndexOf('class="ct-point"');
const insertAt = svg.indexOf("</line>", lastPointEnd) + "</line>".length;
svg = svg.slice(0, insertAt) + tips + svg.slice(insertAt);

// 3. CSS: hover affordance + per-index point→tip pairing.
const pairing = points
  .map((_, i) => `.ct-series line.ct-point:nth-of-type(${i + 1}):hover~g.pt-tip:nth-of-type(${i + 1}){opacity:1}`)
  .join("");
const HOVER_CSS =
  "/*pt-tips*/" +
  ".ct-point{pointer-events:stroke;transition:stroke-width .15s ease}.ct-point:hover{stroke-width:16px}" +
  `.pt-tip{opacity:0;pointer-events:none;transition:opacity .12s ease}.pt-tip text{fill:${TIP_TEXT};font:600 12px 'Segoe UI',Ubuntu,Sans-Serif}` +
  pairing +
  "/*end-pt-tips*/";
svg = svg.replace("</style>", `${HOVER_CSS}\n</style>`);

writeFileSync(SVG_PATH, svg);
console.log(`injected ${points.length} titles + styled tooltips (${MONTHS[endDate.getUTCMonth()]} ${endDate.getUTCDate()} anchor)`);
