import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname,"..");
const temporaryDirectory = resolve(root,"tmp/pdfs");
const renderedChart = resolve(temporaryDirectory,"selection-chart-full.png");
const outputChart = resolve(root,"public/reference/selection-chart.png");

rmSync(temporaryDirectory,{recursive:true,force:true});
mkdirSync(temporaryDirectory,{recursive:true});

try {
  execFileSync("pdftoppm",[
    "-f","1",
    "-singlefile",
    "-png",
    "-r","180",
    resolve(root,"files/selection-chart.pdf"),
    resolve(temporaryDirectory,"selection-chart-full")
  ],{stdio:"inherit"});

  try {
    execFileSync("magick",[renderedChart,"-trim","+repage","-strip",outputChart],{stdio:"inherit"});
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    execFileSync("convert",[renderedChart,"-trim","+repage","-strip",outputChart],{stdio:"inherit"});
  }
  console.log("Rendered full selection chart to public/reference/selection-chart.png");
} finally {
  rmSync(temporaryDirectory,{recursive:true,force:true});
}
