import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function path(relative: string) {
  return new URL(`../${relative}`,import.meta.url);
}

function assertCompleteJpeg(relative: string) {
  const bytes = readFileSync(path(relative));
  assert.ok(bytes.length > 20_000,`${relative} is unexpectedly small`);
  assert.deepEqual([...bytes.subarray(0,2)],[0xff,0xd8],`${relative} has no JPEG start marker`);
  assert.deepEqual([...bytes.subarray(-2)],[0xff,0xd9],`${relative} has no JPEG end marker`);
}

test("every rendered manual JPEG is complete", () => {
  for (let page = 1; page <= 48; page += 1) {
    assertCompleteJpeg(`public/manual/page-${page}.jpg`);
  }
  for (let page = 1; page <= 2; page += 1) {
    assertCompleteJpeg(`public/quick-start/page-${page}.jpg`);
  }
});

test("selection chart is a complete wide PNG with the full chart", () => {
  const relative = "public/reference/selection-chart.png";
  const bytes = readFileSync(path(relative));
  assert.deepEqual(
    [...bytes.subarray(0,8)],
    [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],
    "selection chart has no PNG signature"
  );
  assert.equal(bytes.subarray(-8,-4).toString("ascii"),"IEND","selection chart has no PNG end chunk");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width >= 2400,`selection chart width is only ${width}`);
  assert.ok(width / height >= 2.4,`selection chart aspect ratio ${width / height} suggests clipped or untrimmed content`);
  assert.equal(existsSync(path("public/reference/selection-chart.jpg")),false,"corrupted legacy chart should not remain");
});
