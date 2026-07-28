import test from "node:test";
import assert from "node:assert/strict";
import { agentRuntimePolicy } from "../server/agent.js";
import {
  canonicalizeGroundedResponse, GroundingLedger, verifiedSettingsArtifact
} from "../server/grounding.js";
import { connections } from "../server/product-data.js";
import type { CoreAgentResponse } from "../src/types.js";

function response(overrides: Partial<CoreAgentResponse> = {}): CoreAgentResponse {
  return {
    answer:"Use the verified setup.",
    citations:[],
    artifacts:[],
    needsClarification:false,
    followUp:"",
    ...overrides
  };
}

test("removes every built-in Claude Code tool", () => {
  assert.deepEqual(agentRuntimePolicy.builtInTools,[]);
  assert.ok(agentRuntimePolicy.allowedTools.every(name => name.startsWith("mcp__product__")));
  assert.ok(agentRuntimePolicy.allowedTools.includes("mcp__product__lookup_settings_workflow"));
});

test("rejects a technical response that used no product tool", () => {
  assert.throws(
    () => canonicalizeGroundedResponse(response(),new GroundingLedger()),
    /used no product tool/
  );
});

test("rejects a technical response that skipped manual search", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "lookup_connections",
    connections.MIG,
    [{document:"owner-manual",page:14,title:"MIG connection setup"}]
  );
  assert.throws(
    () => canonicalizeGroundedResponse(response(),ledger),
    /did not search/
  );
});

test("rejects numeric claims absent from tool evidence", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "search_manual",
    {excerpt:"Use the settings shown on the screen."},
    [{document:"owner-manual",page:20,title:"Auto Weld settings"}]
  );
  assert.throws(
    () => canonicalizeGroundedResponse(response({answer:"Set voltage to 99 V."}),ledger),
    /Ungrounded numeric claim/
  );
});

test("drops unverified pages and uses the pages actually returned by tools", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "search_manual",
    {excerpt:"Duty Cycle"},
    [{document:"owner-manual",page:19,title:"Duty-cycle chart"}]
  );
  const grounded = canonicalizeGroundedResponse(response({
    citations:[{document:"owner-manual",page:48,title:"Wrong source"}]
  }),ledger);
  assert.deepEqual(grounded.citations,[{
    document:"owner-manual",page:19,title:"Duty-cycle chart"
  }]);
  assert.ok(grounded.artifacts.some(artifact =>
    artifact.type === "manual-page" &&
    artifact.document === "owner-manual" &&
    artifact.page === 19
  ));
});

test("replaces model-generated connection details with verified product data", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "search_manual",
    {excerpt:"DCEP uses the verified polarity."},
    [{document:"owner-manual",page:14,title:"MIG connection setup"}]
  );
  ledger.record(
    "lookup_connections",
    connections.MIG,
    [{document:"owner-manual",page:14,title:"MIG connection setup"}]
  );
  const grounded = canonicalizeGroundedResponse(response({
    answer:"Use DCEP.",
    citations:[{document:"owner-manual",page:14,title:"MIG connection setup"}],
    artifacts:[{
      type:"connection",
      title:"Untrusted",
      process:"MIG",
      connections:[{label:"Wrong cable",terminal:"negative",note:"Wrong"}],
      warning:"Wrong"
    }]
  }),ledger);
  const connection = grounded.artifacts.find(artifact => artifact.type === "connection");
  assert.equal(connection?.type,"connection");
  assert.deepEqual(connection.connections,connections.MIG.connections);
  assert.equal(connection.warning,connections.MIG.warning);
  assert.doesNotMatch(grounded.answer,/wrong cable/i);
  assert.match(grounded.answer,/wire-feed power cable: positive/i);
});

test("canonical settings artifact uses the correct Stick source page", () => {
  const artifact = verifiedSettingsArtifact({
    process:"Stick",
    voltage:240,
    material:"Mild steel",
    thickness:"1/4 in",
    consumable:"E7018",
    gas:""
  });
  assert.equal(artifact.sourcePage,32);
  assert.match(artifact.warning,/electrode package/i);
  assert.ok(artifact.machineOutputs.some(output => /amperage/i.test(output)));
});

test("replaces unsupported model prose with a verified narrative", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "search_manual",
    [{excerpt:"Connect the wire-feed cable to the positive socket."}],
    [{document:"owner-manual",page:14,title:"MIG connection setup"}]
  );
  ledger.record(
    "lookup_connections",
    connections.MIG,
    [{document:"owner-manual",page:14,title:"MIG connection setup"}],
    [{
      type:"connection",
      title:"MIG connection schematic",
      process:"MIG",
      connections:connections.MIG.connections,
      warning:connections.MIG.warning
    }]
  );
  const grounded = canonicalizeGroundedResponse(response({
    answer:"The machine supports a secret pulse mode.",
    citations:[{document:"owner-manual",page:14,title:"MIG connection setup"}],
    artifacts:[{
      type:"connection",
      title:"MIG connection",
      process:"MIG",
      connections:connections.MIG.connections,
      warning:connections.MIG.warning
    }]
  }),ledger);
  assert.doesNotMatch(grounded.answer,/secret pulse/i);
  assert.match(grounded.answer,/verified mig connection routing/i);
});

test("replaces model clarification choices with verified safe choices", () => {
  const ledger = new GroundingLedger();
  ledger.record(
    "search_manual",
    [{excerpt:"Select the process before choosing settings."}],
    [{document:"owner-manual",page:20,title:"Auto Weld settings"}]
  );
  ledger.record(
    "lookup_settings_workflow",
    {process:null},
    [{document:"owner-manual",page:20,title:"Auto Weld settings"}],
    [verifiedSettingsArtifact({
      process:null,
      voltage:null,
      material:"",
      thickness:"",
      consumable:"",
      gas:""
    })]
  );
  const grounded = canonicalizeGroundedResponse(response({
    answer:"Choose the imaginary plasma mode.",
    needsClarification:true,
    followUp:"Imaginary mode?",
    artifacts:[{
      type:"clarification",
      question:"Choose an unsupported process.",
      options:["Plasma","Laser"]
    },{
      ...verifiedSettingsArtifact({
        process:null,
        voltage:null,
        material:"",
        thickness:"",
        consumable:"",
        gas:""
      })
    }]
  }),ledger);
  const clarification = grounded.artifacts.find(artifact => artifact.type === "clarification");
  assert.equal(clarification?.type,"clarification");
  assert.deepEqual(clarification.options,["MIG setup","Flux-core setup","TIG setup","Stick setup"]);
  assert.doesNotMatch(grounded.answer,/plasma|laser|imaginary/i);
});
