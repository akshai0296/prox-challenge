import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp, BookOpen, Check, ChevronRight, Gauge, GitCompareArrows,
  Image, Plus, ShieldAlert, ShieldCheck, Sparkles, Wrench, X, Zap
} from "lucide-react";
import type {
  AgentResponse, Artifact, ChatMessage, Citation, CoreAgentResponse, DocumentId
} from "./types";
import "./styles.css";

const starters = [
  { icon:Gauge, label:"Duty cycle", prompt:"What's the duty cycle for MIG welding at 200A on 240V?" },
  { icon:Zap, label:"TIG setup", prompt:"What polarity setup do I need for TIG? Which socket does the ground clamp go in?" },
  { icon:ShieldCheck, label:"Fix porosity", prompt:"I'm getting porosity in my flux-cored welds. What should I check?" },
  { icon:GitCompareArrows, label:"Choose a process", prompt:"Which process should a beginner use for thin steel indoors?" }
];

const welcome: ChatMessage = {
  role:"assistant",
  content:"I’m your OmniPro 220 shop copilot. Ask me to configure a process, diagnose a weld, compare methods, or check an exact duty-cycle rating. I’ll ground the answer in the supplied product documents and show the relevant setup."
};

function imagePath(document: DocumentId, page: number) {
  if (document === "owner-manual") return `/manual/page-${page}.jpg`;
  if (document === "quick-start") return `/quick-start/page-${page}.jpg`;
  return "/reference/selection-chart.jpg";
}

function documentLabel(document: DocumentId) {
  if (document === "owner-manual") return "Owner’s manual";
  if (document === "quick-start") return "Quick start";
  return "Selection chart";
}

function DutyCycle({artifact}:{artifact:Extract<Artifact,{type:"duty-cycle"}>}) {
  const [selected,setSelected] = useState(artifact.selectedAmps);
  const rating = artifact.ratings.find(item => item.amps === selected) ?? artifact.ratings[0];
  return <div className="artifact duty">
    <div className="artifact-head"><Gauge size={18}/><span>{artifact.process} · {artifact.voltage} V</span><b>{rating.percent}%</b></div>
    <div className="rating-tabs">
      {artifact.ratings.map(item =>
        <button className={item.amps === rating.amps ? "active" : ""} onClick={()=>setSelected(item.amps)} key={item.amps}>
          {item.amps} A
        </button>
      )}
    </div>
    <div className="cycle-ring" style={{"--fill":`${rating.percent*3.6}deg`} as React.CSSProperties}>
      <strong>{rating.weldMinutes}</strong><span>min welding</span>
    </div>
    <div className="cycle-stats">
      <div><span>REST</span><strong>{rating.restMinutes} min</strong></div>
      <div><span>WINDOW</span><strong>10 min</strong></div>
    </div>
    <small>Only manufacturer-rated points are shown. Arcsmith does not interpolate unlisted duty cycles.</small>
  </div>;
}

function terminalSymbol(terminal:string) {
  if (terminal === "positive") return "+";
  if (terminal === "negative") return "−";
  if (terminal === "gas") return "GAS";
  if (terminal === "screen") return "LCD";
  return "WORK";
}

function Connection({artifact}:{artifact:Extract<Artifact,{type:"connection"}>}) {
  return <div className="artifact connection">
    <div className="artifact-head"><Zap size={18}/><span>{artifact.title}</span></div>
    <div className="connection-list">
      {artifact.connections.map(item =>
        <div className="connection-row" key={`${item.label}-${item.terminal}`}>
          <b className={`terminal ${item.terminal}`}>{terminalSymbol(item.terminal)}</b>
          <div><strong>{item.label}</strong><span>{item.note}</span></div>
        </div>
      )}
    </div>
    <p className="warning"><ShieldAlert size={15}/>{artifact.warning}</p>
  </div>;
}

function Checklist({artifact}:{artifact:Extract<Artifact,{type:"checklist"}>}) {
  const [checked,setChecked] = useState<Set<number>>(new Set());
  function toggle(index:number) {
    setChecked(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }
  return <div className="artifact checklist">
    <div className="artifact-head"><Wrench size={18}/><span>{artifact.title}</span><b>{checked.size}/{artifact.items.length}</b></div>
    {artifact.items.map((item,index) =>
      <button className={`check ${checked.has(index) ? "done" : ""}`} onClick={()=>toggle(index)} key={`${item.check}-${index}`}>
        <i>{checked.has(index) ? <Check size={13}/> : index+1}</i>
        <span><strong>{item.check}</strong><small>{item.action}</small></span>
      </button>
    )}
    <p className="warning"><ShieldAlert size={15}/>{artifact.safety}</p>
  </div>;
}

function ProcessGuide({artifact}:{artifact:Extract<Artifact,{type:"process-guide"}>}) {
  return <div className="artifact process-guide">
    <div className="artifact-head"><GitCompareArrows size={18}/><span>Process recommendation</span></div>
    <div className="recommendation"><span>START WITH</span><strong>{artifact.recommended}</strong></div>
    <ul>{artifact.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
    {artifact.alternatives.length>0 && <div className="alternatives"><span>ALTERNATIVES</span>{artifact.alternatives.map(item=><p key={item}>{item}</p>)}</div>}
    <small>{artifact.source}</small>
  </div>;
}

function ManualPage({artifact}:{artifact:Extract<Artifact,{type:"manual-page"}>}) {
  const path=imagePath(artifact.document,artifact.page);
  return <figure className="manual">
    <a href={path} target="_blank" rel="noreferrer"><img src={path} alt={`${documentLabel(artifact.document)} page ${artifact.page}`}/></a>
    <figcaption><Image size={15}/>{artifact.caption} · {documentLabel(artifact.document)}, p. {artifact.page}</figcaption>
  </figure>;
}

function ArtifactView({artifact,onSelect}:{artifact:Artifact;onSelect:(value:string)=>void}) {
  if (artifact.type==="duty-cycle") return <DutyCycle artifact={artifact}/>;
  if (artifact.type==="connection") return <Connection artifact={artifact}/>;
  if (artifact.type==="checklist") return <Checklist artifact={artifact}/>;
  if (artifact.type==="process-guide") return <ProcessGuide artifact={artifact}/>;
  if (artifact.type==="clarification") return <div className="artifact clarification">
    <div className="artifact-head"><Sparkles size={18}/><span>One detail needed</span></div>
    <p>{artifact.question}</p>
    <div>{artifact.options.map(option=><button onClick={()=>onSelect(option)} key={option}>{option}<ChevronRight size={14}/></button>)}</div>
  </div>;
  return <ManualPage artifact={artifact}/>;
}

function activeFromMessage(message:Extract<ChatMessage,{role:"assistant"}>):CoreAgentResponse {
  return {
    answer:message.content,
    citations:message.citations ?? [],
    artifacts:message.artifacts ?? [],
    needsClarification:false,
    followUp:message.followUp ?? ""
  };
}

function App() {
  const [messages,setMessages] = useState<ChatMessage[]>([welcome]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [active,setActive] = useState<CoreAgentResponse|null>(null);
  const [mode,setMode] = useState<AgentResponse["mode"]|null>(null);
  const conversationId = useRef<string>(crypto.randomUUID());

  async function send(raw=input) {
    const prompt=raw.trim();
    if (!prompt || loading) return;
    const user:ChatMessage={role:"user",content:prompt};
    const next=[...messages,user];
    setMessages(next); setInput(""); setLoading(true);
    try {
      const response=await fetch("/api/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:prompt,history:next.slice(-12),conversationId:conversationId.current})
      });
      const data=await response.json() as AgentResponse|{error:string};
      if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : "Request failed");
      conversationId.current=data.conversationId;
      const assistant:ChatMessage={
        role:"assistant",content:data.answer,citations:data.citations,artifacts:data.artifacts,
        followUp:data.followUp,mode:data.mode
      };
      setMessages(current=>[...current,assistant]);
      setActive(data); setMode(data.mode);
    } catch (error) {
      setMessages(current=>[...current,{
        role:"assistant",
        content:error instanceof Error ? `I could not complete that request: ${error.message}` : "I could not reach the agent.",
        citations:[],artifacts:[]
      }]);
    } finally { setLoading(false); }
  }

  function showCitation(citation:Citation,message:Extract<ChatMessage,{role:"assistant"}>) {
    const response=activeFromMessage(message);
    const alreadyIncluded=response.artifacts.some(artifact =>
      artifact.type==="manual-page" && artifact.document===citation.document && artifact.page===citation.page
    );
    if (!alreadyIncluded) response.artifacts=[
      {type:"manual-page",document:citation.document,page:citation.page,caption:citation.title},
      ...response.artifacts
    ];
    setActive(response);
  }

  async function resetConversation() {
    const oldId=conversationId.current;
    conversationId.current=crypto.randomUUID();
    setMessages([welcome]); setActive(null); setMode(null); setInput("");
    await fetch(`/api/conversations/${oldId}`,{method:"DELETE"}).catch(()=>undefined);
  }

  return <main>
    <aside className="sidebar">
      <div className="brand"><div className="mark"><Sparkles size={20}/></div><div><b>ARCSMITH</b><span>OmniPro 220 copilot</span></div></div>
      <div className="product"><img src="/product.webp" alt="Vulcan OmniPro 220"/><div><span>CONNECTED PRODUCT</span><b>Vulcan OmniPro 220</b><small>120 / 240 V · 4 processes</small></div></div>
      <nav><span>SHOP SHORTCUTS</span>{starters.map(({icon:Icon,label,prompt})=><button onClick={()=>send(prompt)} key={label}><Icon size={17}/>{label}<ChevronRight size={15}/></button>)}</nav>
      <button className="new-chat" onClick={resetConversation}><Plus size={15}/>New conversation</button>
      <div className="source"><BookOpen size={16}/><div><b>51 searchable source pages</b><span>Owner manual, quick start and visual selection chart</span></div></div>
    </aside>
    <section className="conversation">
      <header><div><span className="online"/>Technical support agent</div><span>{mode==="agent"?"CLAUDE AGENT SDK":mode==="offline"?"GROUNDED OFFLINE MODE":"READY"}</span></header>
      <div className="messages">
        {messages.map((message,index)=><div className={`message ${message.role}`} key={index}>
          <label>{message.role==="assistant"?"ARCSMITH":"YOU"}</label>
          <p>{message.content}</p>
          {message.role==="assistant" && (message.citations?.length??0)>0 && <div className="citations">
            {message.citations?.map(source=><button key={`${source.document}-${source.page}`} onClick={()=>showCitation(source,message)}><BookOpen size={13}/>{source.title}, p. {source.page}</button>)}
          </div>}
          {message.role==="assistant" && message.followUp && <div className="follow-up"><ChevronRight size={14}/>{message.followUp}</div>}
        </div>)}
        {loading && <div className="message assistant thinking"><label>ARCSMITH</label><p><i/><i/><i/> Searching the product sources</p></div>}
      </div>
      <div className="composer">
        <div className="suggestions">{messages.length<3 && starters.slice(0,3).map(item=><button onClick={()=>send(item.prompt)} key={item.label}>{item.label}</button>)}</div>
        <div className="input"><textarea aria-label="Ask Arcsmith" value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();send();}}} placeholder="Ask about setup, settings, faults, or weld quality…" rows={1}/><button aria-label="Send" onClick={()=>send()} disabled={!input.trim()||loading}><ArrowUp size={20}/></button></div>
        <small>Disconnect power before changing connections or servicing the machine.</small>
      </div>
    </section>
    <aside className={`artifacts ${active?"open":""}`}>
      <header><span>VISUAL GUIDANCE</span><b>{active?.artifacts.length??0} artifacts</b><button aria-label="Close visual guidance" onClick={()=>setActive(null)}><X size={17}/></button></header>
      <div className="artifact-scroll">
        {active?.artifacts.length
          ? active.artifacts.map((artifact,index)=><ArtifactView artifact={artifact} onSelect={send} key={`${artifact.type}-${index}`}/>)
          : <div className="empty"><Gauge/><b>Answers become tools</b><span>Ask a technical question to see exact calculators, connection maps, diagnostics, and source pages.</span></div>}
      </div>
    </aside>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App/>);
