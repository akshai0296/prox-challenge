import type { DutyRating, WeldingProcess } from "../src/types.js";

export type DutyRecord = {
  process: Exclude<WeldingProcess, "Flux-core"> | "MIG";
  voltage: 120 | 240;
  range: [number, number];
  ratings: DutyRating[];
  page: number;
};

export const dutyRecords: DutyRecord[] = [
  { process:"MIG", voltage:120, range:[30,140], page:19, ratings:[
    { amps:100, percent:40, weldMinutes:4, restMinutes:6 },
    { amps:75, percent:100, weldMinutes:10, restMinutes:0 }
  ]},
  { process:"MIG", voltage:240, range:[30,220], page:19, ratings:[
    { amps:200, percent:25, weldMinutes:2.5, restMinutes:7.5 },
    { amps:115, percent:100, weldMinutes:10, restMinutes:0 }
  ]},
  { process:"TIG", voltage:120, range:[10,125], page:29, ratings:[
    { amps:125, percent:40, weldMinutes:4, restMinutes:6 },
    { amps:90, percent:100, weldMinutes:10, restMinutes:0 }
  ]},
  { process:"TIG", voltage:240, range:[10,175], page:29, ratings:[
    { amps:175, percent:30, weldMinutes:3, restMinutes:7 },
    { amps:105, percent:100, weldMinutes:10, restMinutes:0 }
  ]},
  { process:"Stick", voltage:120, range:[10,80], page:29, ratings:[
    { amps:80, percent:40, weldMinutes:4, restMinutes:6 },
    { amps:60, percent:100, weldMinutes:10, restMinutes:0 }
  ]},
  { process:"Stick", voltage:240, range:[10,175], page:29, ratings:[
    { amps:175, percent:25, weldMinutes:2.5, restMinutes:7.5 },
    { amps:100, percent:100, weldMinutes:10, restMinutes:0 }
  ]}
];

export const connections: Record<WeldingProcess, {
  summary: string;
  page: number;
  connections: Array<{ label: string; terminal: "positive" | "negative" | "gas" | "workpiece" | "screen"; note: string }>;
  warning: string;
}> = {
  MIG: {
    summary: "Solid-core, gas-shielded MIG uses DCEP.",
    page: 14,
    connections: [
      { label:"Wire-feed power cable", terminal:"positive", note:"Twist clockwise fully to lock." },
      { label:"Ground clamp cable", terminal:"negative", note:"Clamp to clean bare metal near the weld." },
      { label:"Shielding-gas hose", terminal:"gas", note:"Connect the regulator outlet to the rear gas inlet." }
    ],
    warning: "Turn the welder off before changing connections. Secure the cylinder upright with two straps."
  },
  "Flux-core": {
    summary: "Self-shielded flux-cored wire uses DCEN.",
    page: 13,
    connections: [
      { label:"Wire-feed power cable", terminal:"negative", note:"Twist clockwise fully to lock." },
      { label:"Ground clamp cable", terminal:"positive", note:"Clamp to clean bare metal near the weld." }
    ],
    warning: "Turn the welder off before changing connections. This applies to self-shielded gasless wire."
  },
  TIG: {
    summary: "For DC TIG on the materials supported by this machine, the torch is normally electrode-negative and the work clamp positive. The OmniPro screen is authoritative.",
    page: 30,
    connections: [
      { label:"TIG torch", terminal:"negative", note:"Use the connection shown by the selected TIG screen." },
      { label:"Ground clamp cable", terminal:"positive", note:"Clamp to clean bare metal near the weld." },
      { label:"Shielding gas", terminal:"gas", note:"Set the screen-indicated flow within the manual's 10–25 SCFH range." },
      { label:"Polarity prompt", terminal:"screen", note:"Confirm every cable against the LCD before energizing the torch." }
    ],
    warning: "TIG requires training beyond this manual. Ventilate the area and never weld without the ground clamp."
  },
  Stick: {
    summary: "Stick polarity depends on the electrode. Follow the electrode package and the OmniPro screen.",
    page: 31,
    connections: [
      { label:"Electrode holder", terminal:"screen", note:"Connect to the terminal specified for the selected electrode." },
      { label:"Ground clamp cable", terminal:"screen", note:"Connect to the opposite terminal shown by the LCD." }
    ],
    warning: "Do not guess Stick polarity. Check the electrode manufacturer's requirements before energizing."
  }
};

export type Diagnostic = {
  process: "MIG" | "Flux-core" | "Any";
  symptom: string;
  page: number;
  safety: string;
  items: Array<{ check: string; action: string }>;
};

export const diagnostics: Diagnostic[] = [
  {
    process:"MIG", symptom:"porosity", page:43,
    safety:"Shut off the welder and discharge the gun to ground before adjusting, cleaning, or repairing it.",
    items:[
      { check:"Shielding-gas cylinder and regulator", action:"Confirm the bottle is not empty and flow is neither too low nor too high." },
      { check:"Nozzle and gas path", action:"Clean the nozzle and confirm the gun connector is fully inserted with no O-rings exposed." },
      { check:"Gas selection", action:"Use the shielding gas recommended by the wire supplier." },
      { check:"Workpiece and wire contamination", action:"Clean to bare metal and use wire free of rust, oil, coatings, and residue." },
      { check:"Contact-tip-to-work distance", action:"Reduce an excessive CTWD and keep it consistent." },
      { check:"Polarity", action:"Confirm DCEP: wire-feed cable positive and ground clamp negative." },
      { check:"Travel speed", action:"Maintain a steady travel speed." }
    ]
  },
  {
    process:"Flux-core", symptom:"porosity", page:37,
    safety:"Shut off the welder and discharge the gun to ground before changing polarity or servicing the feed path.",
    items:[
      { check:"Polarity", action:"Confirm DCEN: wire-feed cable negative and ground clamp positive." },
      { check:"Workpiece and wire contamination", action:"Clean to bare metal and use dry wire free of rust, oil, coatings, and residue." },
      { check:"Contact-tip-to-work distance", action:"Reduce an excessive CTWD and keep it consistent." },
      { check:"Travel speed", action:"Maintain a steady travel speed." },
      { check:"Wire-feed condition", action:"Use the correct roller groove and 2–3 tension so tubular wire is not crushed." }
    ]
  },
  {
    process:"Any", symptom:"wire feed", page:42,
    safety:"Shut off and unplug the welder, then discharge the MIG gun to ground before inspecting the feed system.",
    items:[
      { check:"Feed pressure", action:"Adjust only until the wire bends in the page-17 wood-block test. Too little slips; too much can crush flux-core wire." },
      { check:"Feed-roller groove and size", action:"Flip or replace the roller to match the wire diameter." },
      { check:"Gun cable and liner", action:"Straighten severe bends and inspect the liner for clogs, wear, damage, or incorrect size." },
      { check:"Spool", action:"Check for cross-winding or tangles and confirm the wire reaches the rollers." },
      { check:"Gun connector", action:"Seat the gun cable connector fully in the feed mechanism." },
      { check:"Contact tip", action:"Use the correct unworn contact-tip size for the installed wire." }
    ]
  }
];

export const processGuide: Record<WeldingProcess, {
  skill: string;
  gas: string;
  materials: string[];
  thickness: string;
  strengths: string[];
  tradeoffs: string[];
}> = {
  "Flux-core": {
    skill:"Low", gas:"No shielding gas", materials:["Steel","Stainless steel"], thickness:"18 gauge to 5/16 inch",
    strengths:["Outdoor and windy work","Rusty or dirty steel","Out-of-position welding","High deposition rate"],
    tradeoffs:["More spatter","Not the cleanest finish"]
  },
  MIG: {
    skill:"Low", gas:"Shielding gas required", materials:["Steel","Stainless steel","Aluminum with optional spool gun"], thickness:"22 gauge to 3/8 inch",
    strengths:["Fast production","Easiest process to learn","Clean welds with minimal spatter","Good thin-material control"],
    tradeoffs:["Indoor welding recommended","Gas cylinder required"]
  },
  Stick: {
    skill:"Moderate", gas:"No shielding gas", materials:["Steel","Stainless steel","Castings"], thickness:"10 gauge to 1/2 inch",
    strengths:["Outdoor and windy work","Deep penetration","Rusty or dirty steel","Thicker material"],
    tradeoffs:["More spatter","Slag removal required"]
  },
  TIG: {
    skill:"High", gas:"Shielding gas required", materials:["Steel","Stainless steel","Chrome moly"], thickness:"24 gauge to 3/16 inch",
    strengths:["Highest-quality finish","Precise control","Extremely clean welds","Good for thin material"],
    tradeoffs:["Slow and skill intensive","Indoor welding recommended","This machine is DC TIG and is not intended for TIG aluminum"]
  }
};

export function normalizeProcess(value: string | undefined): WeldingProcess | undefined {
  if (!value) return undefined;
  const text = value.toLowerCase();
  if (text.includes("flux") || text.includes("fcaw") || text.includes("gasless") || text.includes("self-shield")) return "Flux-core";
  if (text.includes("mig") || text.includes("gmaw") || text.includes("solid wire") || text.includes("gas-shield")) return "MIG";
  if (text.includes("tig") || text.includes("gtaw")) return "TIG";
  if (text.includes("stick") || text.includes("smaw") || text.includes("electrode")) return "Stick";
  return undefined;
}
