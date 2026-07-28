import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { clearConversation, runClaudeAgent } from "./agent.js";
import { runOfflineAgent } from "./offline-agent.js";
import { getCorpusStats } from "./retrieval.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit:"256kb" }));

app.get("/api/health", (_, res) => {
  res.json({
    ok:true,
    mode:process.env.ANTHROPIC_API_KEY ? "agent" : "offline",
    corpus:getCorpusStats()
  });
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0,4000) : "";
  const suppliedId = typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
  const conversationId = /^[a-zA-Z0-9-]{8,80}$/.test(suppliedId) ? suppliedId : randomUUID();
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
  if (!message) return res.status(400).json({error:"A non-empty message is required."});

  if (!process.env.ANTHROPIC_API_KEY) {
    const response = runOfflineAgent(message,history);
    return res.json({...response,mode:"offline",conversationId});
  }

  try {
    const response = await runClaudeAgent(message,conversationId);
    return res.json({...response,mode:"agent",conversationId});
  } catch (error) {
    console.error("Claude Agent SDK request failed; using grounded offline reasoner.",error);
    const response = runOfflineAgent(message,history);
    return res.json({...response,mode:"offline",conversationId});
  }
});

app.delete("/api/conversations/:conversationId", (req,res) => {
  clearConversation(req.params.conversationId);
  res.status(204).end();
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist",{maxAge:"1h"}));
  app.get("*", (_,res) => res.sendFile("index.html",{root:"dist"}));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  const stats = getCorpusStats();
  console.log(`Arcsmith listening on http://localhost:${port} with ${stats.totalPages} indexed pages`);
});
