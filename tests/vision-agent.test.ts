import assert from "node:assert/strict";
import test from "node:test";
import { runVisionAgent } from "../server/vision-agent.js";

test("sends the image to Claude and returns grounded visual guidance", async () => {
  const response=await runVisionAgent(
    {
      dataUrl:"data:image/jpeg;base64,/9j/4AAQ",
      mediaType:"image/jpeg"
    },
    "Inspect this MIG weld",
    "test-key",
    async (input,init) => {
      assert.equal(String(input),"https://api.anthropic.com/v1/messages");
      const request=JSON.parse(String(init?.body));
      assert.equal(request.messages[0].content[0].type,"image");
      assert.equal(request.messages[0].content[0].source.media_type,"image/jpeg");
      return new Response(JSON.stringify({
        content:[{type:"text",text:JSON.stringify({
          visibleObservations:["Small surface cavities are visible along the bead."],
          likelyDefects:[{
            name:"Possible porosity",
            confidence:"medium",
            evidence:"The visible cavities are consistent with surface porosity."
          }],
          limitations:"One photo cannot establish cavity depth.",
          nextQuestion:"Was this gas-shielded MIG or self-shielded flux-core?"
        })}]
      }),{status:200,headers:{"content-type":"application/json"}});
    }
  );
  assert.match(response.answer,/surface cavities/i);
  assert.ok(response.citations.some(citation=>citation.page===37));
  assert.ok(response.artifacts.some(artifact=>artifact.type==="checklist"));
});

test("rejects a malformed Claude vision response", async () => {
  await assert.rejects(
    runVisionAgent(
      {dataUrl:"data:image/png;base64,iVBORw0KGgo=",mediaType:"image/png"},
      "Inspect this",
      "test-key",
      async () => new Response(JSON.stringify({
        content:[{type:"text",text:"not json"}]
      }),{status:200})
    ),
    /invalid vision response/
  );
});
