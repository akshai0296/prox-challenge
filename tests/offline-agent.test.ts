import test from "node:test";
import assert from "node:assert/strict";
import { runOfflineAgent } from "../server/offline-agent.js";
import { dutyRecords } from "../server/product-data.js";

function dutyArtifact(response: ReturnType<typeof runOfflineAgent>) {
  return response.artifacts.find(artifact => artifact.type === "duty-cycle");
}

test("matches every published manufacturer duty-cycle rating", () => {
  for (const record of dutyRecords) {
    for (const rating of record.ratings) {
      const response = runOfflineAgent(
        `${record.process} duty cycle at ${rating.amps}A on ${record.voltage}V`
      );
      assert.match(response.answer,new RegExp(`${rating.percent}%`));
      const artifact = dutyArtifact(response);
      assert.equal(artifact?.type,"duty-cycle");
      assert.equal(artifact?.voltage,record.voltage);
      assert.ok(artifact.ratings.some(item =>
        item.amps === rating.amps &&
        item.percent === rating.percent &&
        item.weldMinutes === rating.weldMinutes &&
        item.restMinutes === rating.restMinutes
      ));
    }
  }
});

test("returns the exact 240 V MIG rating at 200 A", () => {
  const response = runOfflineAgent("What's the duty cycle for MIG welding at 200A on 240V?");
  assert.match(response.answer,/25%/);
  assert.match(response.answer,/2\.5 minutes/);
  assert.match(response.answer,/7\.5 minutes/);
  const artifact = dutyArtifact(response);
  assert.equal(artifact?.type,"duty-cycle");
  assert.equal(artifact?.process,"MIG");
  assert.equal(artifact?.voltage,240);
});

test("keeps TIG duty-cycle ratings separate from MIG", () => {
  const response = runOfflineAgent("What's the TIG duty cycle at 175A on 240V?");
  assert.match(response.answer,/30%/);
  assert.match(response.answer,/3 minutes/);
  assert.doesNotMatch(response.answer,/200 A/);
  const artifact = dutyArtifact(response);
  assert.equal(artifact?.type,"duty-cycle");
  assert.equal(artifact?.process,"TIG");
});

test("keeps 120 V duty-cycle ratings separate from 240 V", () => {
  const response = runOfflineAgent("What's the MIG duty cycle at 100A on 120V?");
  assert.match(response.answer,/40%/);
  assert.match(response.answer,/4 minutes/);
  const artifact = dutyArtifact(response);
  assert.equal(artifact?.type,"duty-cycle");
  assert.equal(artifact?.voltage,120);
});

test("refuses to interpolate an unlisted duty cycle", () => {
  const response = runOfflineAgent("MIG duty cycle at 150A on 240V");
  assert.match(response.answer,/does not publish an exact duty cycle/i);
  assert.match(response.answer,/not be estimated by linear interpolation/i);
});

test("rejects amperage outside the selected input range", () => {
  const response = runOfflineAgent("MIG duty cycle at 200A on 120V");
  assert.match(response.answer,/outside the 30–140 A output range/);
});

test("uses conversation history for an elliptical voltage follow-up", () => {
  const response = runOfflineAgent("What about 120V?",[
    {role:"user",content:"What's the MIG duty cycle at 200A on 240V?"},
    {role:"assistant",content:"25% at 200 A."}
  ]);
  assert.match(response.answer,/outside the 30–140 A output range/);
});

test("asks for process before diagnosing ambiguous porosity", () => {
  const response = runOfflineAgent("My weld has porosity. What should I check?");
  assert.equal(response.needsClarification,true);
  assert.match(response.answer,/gas-shielded MIG and self-shielded flux-core/i);
  assert.equal(response.artifacts[0]?.type,"clarification");
});

test("includes shielding-gas checks for MIG porosity", () => {
  const response = runOfflineAgent("I have porosity in gas-shielded MIG");
  assert.match(response.answer,/gas delivery/);
  const checklist = response.artifacts.find(artifact => artifact.type === "checklist");
  assert.equal(checklist?.type,"checklist");
  assert.ok(checklist.items.some(item => /cylinder|regulator/i.test(item.check)));
  assert.ok(checklist.items.some(item => /nozzle|gas path/i.test(item.check)));
});

test("does not prescribe shielding-gas adjustment for self-shielded flux-core", () => {
  const response = runOfflineAgent("I have porosity in self-shielded flux-core");
  assert.match(response.answer,/do not apply to self-shielded wire/i);
  const checklist = response.artifacts.find(artifact => artifact.type === "checklist");
  assert.equal(checklist?.type,"checklist");
  assert.ok(!checklist.items.some(item => /gas cylinder|regulator|nozzle/i.test(`${item.check} ${item.action}`)));
});

test("wire-feed failure checks more than tension", () => {
  const response = runOfflineAgent("My wire will not feed. What should I inspect?");
  const checklist = response.artifacts.find(artifact => artifact.type === "checklist");
  assert.equal(checklist?.type,"checklist");
  const text = checklist.items.map(item => `${item.check} ${item.action}`).join(" ");
  assert.match(text,/roller/i);
  assert.match(text,/liner/i);
  assert.match(text,/spool/i);
  assert.match(text,/contact tip/i);
});

test("keeps exact tension guidance available", () => {
  const response = runOfflineAgent("What feed tension should I use for flux-core wire?");
  assert.match(response.answer,/2–3/);
  assert.match(response.answer,/less than three seconds/i);
});

test("requires missing setup dimensions instead of guessing settings", () => {
  const response = runOfflineAgent("What settings should I use?");
  assert.equal(response.needsClarification,true);
  assert.match(response.answer,/process, input voltage, material, thickness/i);
  assert.deepEqual(response.citations.map(item => item.page),[20,30,32]);
  assert.ok(response.artifacts.some(artifact => artifact.type === "settings-configurator"));
});

test("returns a grounded interactive settings workflow when setup inputs are complete", () => {
  const response = runOfflineAgent(
    "What settings should I use for MIG on 240 V with 1/8 inch mild steel, 0.030 solid wire, and C25 gas?"
  );
  assert.equal(response.needsClarification,false);
  const configurator = response.artifacts.find(artifact => artifact.type === "settings-configurator");
  assert.equal(configurator?.type,"settings-configurator");
  assert.equal(configurator.process,"MIG");
  assert.equal(configurator.voltage,240);
  assert.equal(configurator.gas,"75% argon / 25% CO2");
  assert.equal(configurator.sourcePage,20);
  assert.ok(configurator.machineOutputs.some(output => /wire-feed speed/i.test(output)));
  assert.doesNotMatch(response.answer,/set (?:the )?voltage to \d/i);
});

test("uses the visual selection chart for process recommendations", () => {
  const response = runOfflineAgent("Which process is best for a beginner welding thin steel indoors?");
  assert.match(response.answer,/Start with MIG/);
  assert.ok(response.citations.some(item => item.document === "selection-chart"));
  assert.ok(response.artifacts.some(item => item.type === "process-guide" && item.recommended === "MIG"));
});

test("keeps solid-wire MIG and self-shielded flux-core polarity separate", () => {
  const mig = runOfflineAgent("Which sockets should I use for solid-wire MIG polarity?");
  const flux = runOfflineAgent("Which sockets should I use for self-shielded flux-core polarity?");
  assert.match(mig.answer,/DCEP/);
  assert.match(mig.answer,/positive/);
  assert.match(flux.answer,/DCEN/);
  const migMap = mig.artifacts.find(artifact => artifact.type === "connection");
  const fluxMap = flux.artifacts.find(artifact => artifact.type === "connection");
  assert.equal(migMap?.type,"connection");
  assert.equal(fluxMap?.type,"connection");
  assert.equal(migMap.connections.find(item => /wire-feed/i.test(item.label))?.terminal,"positive");
  assert.equal(fluxMap.connections.find(item => /wire-feed/i.test(item.label))?.terminal,"negative");
});

test("does not guess Stick polarity without an electrode classification", () => {
  const response = runOfflineAgent("How should I connect the electrode holder for Stick?");
  assert.equal(response.needsClarification,true);
  assert.match(response.answer,/depends on the electrode/i);
  assert.match(response.followUp,/electrode classification/i);
  assert.deepEqual(response.citations.map(item => item.page),[27,32]);
  const connection = response.artifacts.find(artifact => artifact.type === "connection");
  assert.equal(connection?.type,"connection");
  assert.equal(connection.connections.find(item => /electrode holder/i.test(item.label))?.terminal,"positive");
  assert.equal(connection.connections.find(item => /ground clamp/i.test(item.label))?.terminal,"negative");
  assert.ok(connection.connections.some(item => item.terminal === "screen"));
});

test("uses the physical TIG cable diagram and the operating-screen page", () => {
  const response = runOfflineAgent("Which socket should I use for the TIG torch and ground clamp?");
  assert.deepEqual(response.citations.map(item => item.page),[24,30]);
  const connection = response.artifacts.find(artifact => artifact.type === "connection");
  assert.equal(connection?.type,"connection");
  assert.equal(connection.connections.find(item => /tig torch/i.test(item.label))?.terminal,"negative");
  assert.equal(connection.connections.find(item => /ground clamp/i.test(item.label))?.terminal,"positive");
});

test("asks for a process when a connection request is ambiguous", () => {
  const response = runOfflineAgent("Which socket does the ground clamp use?");
  assert.equal(response.needsClarification,true);
  assert.equal(response.artifacts[0]?.type,"clarification");
});
