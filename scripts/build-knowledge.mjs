import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "knowledge");
mkdirSync(outputDir, { recursive: true });

const sources = [
  { id: "owner-manual", file: "files/owner-manual.pdf", title: "Owner's Manual & Safety Instructions" },
  { id: "quick-start", file: "files/quick-start-guide.pdf", title: "Quick Start Guide" }
];

const pages = [];
for (const source of sources) {
  const pdf = resolve(root, source.file);
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  const extracted = text.split("\f");
  if (!extracted.at(-1)?.trim()) extracted.pop();
  extracted.forEach((pageText, index) => {
    pages.push({
      document: source.id,
      documentTitle: source.title,
      sourceFile: basename(source.file),
      page: index + 1,
      text: pageText.replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim()
    });
  });
}

pages.push({
  document: "selection-chart",
  documentTitle: "How to Choose a Welder",
  sourceFile: "selection-chart.pdf",
  page: 1,
  text: `Visual process-selection chart.
Flux-cored / FCAW: low skill level; no shielding gas required; steel and stainless steel; 18 gauge to 5/16 inch; useful for galvanized steel, pipe and tubing, general fabrication, and maintenance or repair; produces more spatter; ideal outdoors or in windy conditions; forgiving on rusty or dirty steel; good out-of-position capability; high deposition rate.
MIG / GMAW: low skill level; shielding gas required and indoor welding recommended; steel, stainless steel, and aluminum with a spool gun; 22 gauge to 3/8 inch; useful for sheet metal, tubing, automotive body, and structural steel; clean welds with minimal spatter; fast production; easiest to learn; no slag; good control on thin material.
Stick / SMAW: moderate skill level; no shielding gas required; steel, stainless steel, and castings; 10 gauge to 1/2 inch; useful for pipe and tubing, pressure vessels, structural steel, and maintenance or repair; more spatter; good outdoors or in windy conditions; forgiving on rusty or dirty steel; deep penetration; suited to thicker material.
TIG / GTAW: high skill level; shielding gas required and indoor welding recommended; steel, stainless steel, and chrome moly require DC TIG; aluminum and magnesium alloys require AC TIG; 24 gauge to 3/16 inch; useful for stainless exhausts, bicycle frames, thin-wall pipe and tubing, and metal art; extremely clean; highest-quality and aesthetically precise welds; can be used on many materials.
MIG uses coiled solid wire, shielding gas, and produces clean welds with little spatter. Flux-core uses coiled flux wire, needs no shielding gas, can be used outdoors in windy conditions, offers deep penetration, handles thicker material, and can produce more spatter.
Duty cycle is the number of minutes within a 10-minute period that a welding power source can be safely used at a given current without overheating.`
});

writeFileSync(resolve(outputDir, "manual-pages.json"), `${JSON.stringify(pages, null, 2)}\n`);
console.log(`Wrote ${pages.length} searchable pages to knowledge/manual-pages.json`);
