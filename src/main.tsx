import React, { useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp, BookOpen, Check, ChevronRight, Gauge, GitCompareArrows,
  Image, ImagePlus, Plus, Settings2, ShieldAlert, ShieldCheck, Sparkles, Wrench, X, Zap
} from "lucide-react";
import type {
  AgentResponse, Artifact, ChatMessage, Citation, CoreAgentResponse, DocumentId, WeldingProcess
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

const configuratorProfiles: Record<WeldingProcess, {
  materials: string[];
  consumables: string[];
  gases: string[];
  outputs: string[];
  sourcePage: number;
}> = {
  MIG: {
    materials:["Mild steel","Stainless steel","Aluminum with optional spool gun"],
    consumables:["0.025 in solid wire","0.030 in solid wire","0.035 in solid wire","Aluminum wire with optional spool gun"],
    gases:["75% argon / 25% CO2","100% CO2"],
    outputs:["Wire-feed speed (amperage)","Voltage"],
    sourcePage:20
  },
  "Flux-core": {
    materials:["Mild steel","Stainless steel"],
    consumables:["0.030 in flux-cored wire","0.035 in flux-cored wire","0.045 in flux-cored wire"],
    gases:[],
    outputs:["Wire-feed speed (amperage)","Voltage"],
    sourcePage:20
  },
  TIG: {
    materials:["Mild steel","Stainless steel","Chrome moly"],
    consumables:["TIG rod diameter from the machine screen"],
    gases:["100% argon"],
    outputs:["Output amperage","Screen-confirmed polarity and gas"],
    sourcePage:30
  },
  Stick: {
    materials:["Mild steel","Stainless steel"],
    consumables:["Electrode classification and diameter from its package"],
    gases:[],
    outputs:["Output amperage","Screen-confirmed polarity","Hot Start and Arc Force"],
    sourcePage:32
  }
};

function imagePath(document: DocumentId, page: number) {
  if (document === "owner-manual") return `/manual/page-${page}.jpg`;
  if (document === "quick-start") return `/quick-start/page-${page}.jpg`;
  return "/reference/selection-chart.png";
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
  const outputConnections = artifact.connections.filter(
    item => item.terminal === "positive" || item.terminal === "negative"
  );
  const auxiliaryConnections = artifact.connections.filter(
    item => item.terminal !== "positive" && item.terminal !== "negative"
  );
  return <div className="artifact connection">
    <div className="artifact-head"><Zap size={18}/><span>{artifact.title}</span></div>
    <div className="socket-schematic">
      <div className="machine-screen">OMNIPRO 220 OUTPUT PANEL</div>
      <div className="socket-bank" aria-label="Physical output socket layout">
        <div><b className="socket negative">−</b><span>NEGATIVE</span></div>
        <div><b className="socket positive">+</b><span>POSITIVE</span></div>
      </div>
      <div className="cable-links">
        {outputConnections.length ? outputConnections.map(item =>
          <div className={`cable-link ${item.terminal}`} key={`map-${item.label}`}>
            <strong>{item.label}</strong><i/><b>{item.terminal === "positive" ? "+" : "−"}</b>
          </div>
        ) : <div className="screen-routing"><b>LCD</b><span>The electrode selection determines both output sockets.</span></div>}
      </div>
    </div>
    <div className="connection-list">
      {auxiliaryConnections.map(item =>
        <div className="connection-row" key={`${item.label}-${item.terminal}`}>
          <b className={`terminal ${item.terminal}`}>{terminalSymbol(item.terminal)}</b>
          <div><strong>{item.label}</strong><span>{item.note}</span></div>
        </div>
      )}
    </div>
    <p className="warning"><ShieldAlert size={15}/>{artifact.warning}</p>
  </div>;
}

function SettingsConfigurator({
  artifact,onSelect
}:{
  artifact:Extract<Artifact,{type:"settings-configurator"}>;
  onSelect:(value:string)=>void;
}) {
  const [process,setProcess] = useState<WeldingProcess|"" >(artifact.process ?? "");
  const [voltage,setVoltage] = useState<120|240|"" >(artifact.voltage ?? "");
  const [material,setMaterial] = useState(artifact.material);
  const [thickness,setThickness] = useState(artifact.thickness);
  const [consumable,setConsumable] = useState(artifact.consumable);
  const [gas,setGas] = useState(artifact.gas);
  const consumableListId = useId();
  const gasListId = useId();
  const profile = process ? configuratorProfiles[process] : null;
  const complete = Boolean(
    process &&
    voltage &&
    material.trim() &&
    thickness.trim() &&
    consumable.trim() &&
    (!profile?.gases.length || gas.trim())
  );

  function chooseProcess(value: WeldingProcess|"") {
    setProcess(value);
    setMaterial("");
    setConsumable("");
    setGas("");
  }

  function applyConfiguration() {
    if (!complete || !process || !voltage) return;
    onSelect(
      `Configure ${process} on ${voltage} V for ${material}, ${thickness}, using ${consumable}${gas ? ` with ${gas} shielding gas` : ""}. Use the OmniPro Auto Weld workflow and do not invent unpublished numeric settings.`
    );
  }

  return <div className="artifact settings-configurator">
    <div className="artifact-head"><Settings2 size={18}/><span>Auto Weld configurator</span></div>
    <div className="config-grid">
      <label><span>PROCESS</span><select value={process} onChange={event=>chooseProcess(event.target.value as WeldingProcess|"")}>
        <option value="">Select process</option>
        {(["MIG","Flux-core","TIG","Stick"] as WeldingProcess[]).map(value=><option value={value} key={value}>{value}</option>)}
      </select></label>
      <label><span>INPUT</span><select value={voltage} onChange={event=>setVoltage(event.target.value ? Number(event.target.value) as 120|240 : "")}>
        <option value="">Select voltage</option><option value="120">120 V</option><option value="240">240 V</option>
      </select></label>
      <label><span>MATERIAL</span><select value={material} disabled={!profile} onChange={event=>setMaterial(event.target.value)}>
        <option value="">Select material</option>
        {profile?.materials.map(value=><option value={value} key={value}>{value}</option>)}
      </select></label>
      <label><span>THICKNESS</span><input value={thickness} onChange={event=>setThickness(event.target.value)} placeholder='Example: 1/8 in'/></label>
      <label className="config-wide"><span>CONSUMABLE</span>
        <input list={consumableListId} value={consumable} disabled={!profile} onChange={event=>setConsumable(event.target.value)} placeholder="Wire, rod, or electrode"/>
        <datalist id={consumableListId}>{profile?.consumables.map(value=><option value={value} key={value}/>)}</datalist>
      </label>
      {profile?.gases.length ? <label className="config-wide"><span>SHIELDING GAS</span>
        <input list={gasListId} value={gas} onChange={event=>setGas(event.target.value)} placeholder="Select or enter shielding gas"/>
        <datalist id={gasListId}>{profile.gases.map(value=><option value={value} key={value}/>)}</datalist>
      </label> : null}
    </div>
    <div className="machine-output">
      <span>MACHINE-GENERATED OUTPUT</span>
      {profile
        ? <ul>{profile.outputs.map(output=><li key={output}>{output}</li>)}</ul>
        : <p>Select a process to reveal the OmniPro controls.</p>}
    </div>
    <button className="apply-config" disabled={!complete} onClick={applyConfiguration}>Apply setup in chat<ChevronRight size={15}/></button>
    <p className="warning"><ShieldAlert size={15}/>{artifact.warning}</p>
    <small>Source: owner’s manual, p. {profile?.sourcePage ?? artifact.sourcePage}. The machine screen remains authoritative.</small>
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
  if (artifact.type==="settings-configurator") return <SettingsConfigurator artifact={artifact} onSelect={onSelect}/>;
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
  const [attachment,setAttachment] = useState<{file:File;url:string}|null>(null);
  const [attachmentError,setAttachmentError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const conversationId = useRef<string>(crypto.randomUUID());

  function chooseImage(file:File|undefined) {
    setAttachmentError("");
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) {
      setAttachmentError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5*1024*1024) {
      setAttachmentError("Image must be 5 MB or smaller.");
      return;
    }
    setAttachment(current => {
      if (current) URL.revokeObjectURL(current.url);
      return {file,url:URL.createObjectURL(file)};
    });
  }

  function removeImage() {
    setAttachment(current => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (fileInput.current) fileInput.current.value="";
  }

  function readDataUrl(file:File) {
    return new Promise<string>((resolve,reject) => {
      const reader=new FileReader();
      reader.onload=()=>typeof reader.result==="string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the image."));
      reader.onerror=()=>reject(new Error("Could not read the image."));
      reader.readAsDataURL(file);
    });
  }

  async function send(raw=input) {
    const prompt=raw.trim();
    if ((!prompt && !attachment) || loading) return;
    const activeAttachment=attachment;
    const user:ChatMessage={
      role:"user",
      content:prompt || "Inspect this weld photo.",
      imageUrl:activeAttachment?.url,
      imageName:activeAttachment?.file.name
    };
    const next=[...messages,user];
    setMessages(next); setInput(""); setAttachment(null); setAttachmentError(""); setLoading(true);
    if (fileInput.current) fileInput.current.value="";
    try {
      const image=activeAttachment ? {
        dataUrl:await readDataUrl(activeAttachment.file),
        mediaType:activeAttachment.file.type,
        name:activeAttachment.file.name
      } : undefined;
      const response=await fetch("/api/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          message:prompt,
          history:next.slice(-12),
          conversationId:conversationId.current,
          image
        })
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
    removeImage();
    setMessages([welcome]); setActive(null); setMode(null); setInput(""); setAttachmentError("");
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
          {message.role==="user" && message.imageUrl && <figure className="user-image">
            <img src={message.imageUrl} alt={message.imageName || "Attached weld"}/>
            <figcaption>{message.imageName}</figcaption>
          </figure>}
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
        {attachment && <div className="attachment-preview">
          <img src={attachment.url} alt="Selected weld"/>
          <div><b>{attachment.file.name}</b><span>{(attachment.file.size/1024/1024).toFixed(1)} MB · ready to inspect</span></div>
          <button aria-label="Remove attached image" onClick={removeImage}><X size={16}/></button>
        </div>}
        {attachmentError && <div className="attachment-error" role="alert">{attachmentError}</div>}
        <div className="input">
          <input ref={fileInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>chooseImage(event.target.files?.[0])}/>
          <button className="attach" aria-label="Attach weld image" title="Attach weld image" onClick={()=>fileInput.current?.click()} disabled={loading}><ImagePlus size={20}/></button>
          <textarea aria-label="Ask Arcsmith" value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();send();}}} placeholder={attachment ? "Describe the weld, process, or symptom…" : "Ask about setup, settings, faults, or weld quality…"} rows={1}/>
          <button className="send" aria-label="Send" onClick={()=>send()} disabled={(!input.trim()&&!attachment)||loading}><ArrowUp size={20}/></button>
        </div>
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
