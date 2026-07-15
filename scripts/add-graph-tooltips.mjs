/**
 * Injects native SVG hover tooltips into assets/activity-graph.svg.
 *
 * The activity graph fetched from github-readme-activity-graph.vercel.app
 * renders one Chartist point per day (<line class="ct-point" ct:value="N">)
 * but gives it no <title>, so hovering shows nothing. This script adds a
 * <title>N contributions · Mon D, YYYY</title> child to every point plus a
 * hover style that fattens the hovered dot.
 *
 * Tooltips only appear where the SVG is rendered as a real document (raw
 * file URL, local browser, VS Code preview, inline embed on a website).
 * GitHub READMEs display images through <img>, which browsers render
 * statically — no hover is possible there; that is a platform restriction,
 * not something this script can change.
 *
 * Dates: the graph's x-axis labels are bare day-of-month numbers covering
 * the last 31 days. The full dates are reconstructed by scanning backwards
 * from today for an end date whose 31-day walk matches every label —
 * robust to the SVG being a day or two stale when this runs.
 *
 * Idempotent: previously injected titles are stripped before re-inserting.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SVG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "activity-graph.svg");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let svg = readFileSync(SVG_PATH, "utf8");

// Strip any titles injected by a previous run.
svg = svg.replace(/(<line[^>]*class="ct-point"[^>]*>)<title>[^<]*<\/title>/g, "$1");

// X-axis labels, in order — bare day-of-month numbers.
const labels = [...svg.matchAll(/class="ct-label ct-horizontal ct-end"[^>]*>(\d+)</g)].map((m) => Number(m[1]));

// Points, in the same order.
const points = [...svg.matchAll(/<line[^>]*class="ct-point"[^>]*>/g)];

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

let index = 0;
svg = svg.replace(/(<line[^>]*class="ct-point"[^>]*ct:value="(\d+)"[^>]*>)/g, (whole, openTag, value) => {
  const d = new Date(endDate);
  d.setUTCDate(d.getUTCDate() - (labels.length - 1 - index));
  index++;
  const n = Number(value);
  const dateText = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return `${openTag}<title>${n} contribution${n === 1 ? "" : "s"} · ${dateText}</title>`;
});

// Hover affordance: fatten the hovered dot. Appended last so it wins the
// cascade; harmless if already present from a previous run.
const HOVER_CSS = ".ct-point{pointer-events:stroke;transition:stroke-width .15s ease}.ct-point:hover{stroke-width:16px}";
if (!svg.includes(HOVER_CSS)) {
  svg = svg.replace("</style>", `${HOVER_CSS}\n</style>`);
}

writeFileSync(SVG_PATH, svg);
console.log(`injected tooltips for ${index} points (${MONTHS[endDate.getUTCMonth()]} ${endDate.getUTCDate()} anchor)`);
