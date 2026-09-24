#!/usr/bin/env node
/* make_bambu_template.mjs — turn project_settings.config files written by Bambu Studio into the
 * template the relief exporter embeds, so a downloaded 3MF opens as a Bambu project with one
 * filament per chosen colour.
 *
 *   node tools/make_bambu_template.mjs ps_2filaments.json ps_4filaments.json
 *
 * The two inputs come from the same printer/process with 2 and 4 filaments (Bambu Studio CLI
 * slice outputs, Metadata/project_settings.config). Keys whose arrays grow 2 -> 4 are
 * per-filament; they are stored once (slot 0). Writes data/bambu/a1_project.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [f2, f4] = process.argv.slice(2);
if (!f2 || !f4) { console.error("usage: make_bambu_template.mjs <2-filament config> <4-filament config>"); process.exit(2); }
const a = JSON.parse(fs.readFileSync(f2, "utf8")), b = JSON.parse(fs.readFileSync(f4, "utf8"));

const perFilament = [], plusTwo = [];
const config = {};
for (const k of Object.keys(b)) {
  const x = a[k], y = b[k];
  if (Array.isArray(x) && Array.isArray(y) && x.length === 2 && y.length === 4) { perFilament.push(k); config[k] = [y[0]]; }
  else if (Array.isArray(x) && Array.isArray(y) && x.length === 4 && y.length === 6) { plusTwo.push(k); config[k] = [""]; }
  else if (k === "flush_volumes_matrix") config[k] = ["0"];
  else config[k] = y;
}
// name the system presets these values came from, so Bambu Studio shows them as such
Object.assign(config, {
  printer_settings_id: "Bambu Lab A1 0.4 nozzle",
  print_settings_id: "0.20mm Standard @BBL A1",
  filament_settings_id: ["Bambu PLA Basic @BBL A1"],
  filament_ids: ["GFA00"],
  filament_vendor: ["Bambu Lab"],
  filament_type: ["PLA"],
});
const out = path.join(ROOT, "data", "bambu", "a1_project.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  note: "Bambu Studio project settings (Bambu Lab A1 0.4, 0.20mm Standard, Bambu PLA Basic), from Bambu Studio "
    + config.version + ". Per-filament keys hold one slot; the exporter repeats them per colour.",
  application: "BambuStudio-" + config.version,
  perFilament, plusTwo, config,
}));
console.log(`per-filament ${perFilament.length}, plus-two ${plusTwo.join(",")}, ${Object.keys(config).length} keys -> ${out}`);
