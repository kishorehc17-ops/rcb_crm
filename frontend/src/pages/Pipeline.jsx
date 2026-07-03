import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import {
  Plus, X, Search, Send, MessageCircle, MapPin, Calendar as CalIcon,
  ChevronRight, ChevronLeft, Phone, User as UserIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STAGES = ["Lead", "Contacted", "Quotation Sent", "Negotiation", "Booked", "Completed", "Review Received"];
const SOURCES = ["Meta Ads", "Website", "WhatsApp", "Manual"];
const emptyLead = { name: "", mobile: "", source: "Manual", stage: "Lead", notes: "", event_date: "", theme: "", location: "" };

function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

const stageColors = {
  "Lead": "bg-slate-100 text-slate-700",
  "Contacted": "bg-blue-100 text-blue-700",
  "Quotation Sent": "bg-amber-100 text-amber-700",
  "Negotiation": "bg-purple-100 text-purple-700",
  "Booked": "bg-green-100 text-green-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Review Received": "bg-pink-100 text-pink-700",
};

export default function Pipeline() {
  const [leads, setLeads] = useState([]);
  const [convos, setConvos] = useState([]);
  const [activeWa, setActiveWa] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showMock, setShowMock] = useState(false);
  const [form, setForm] = useState(emptyLead);
  const [mock, setMock] = useState({ wa_id: "", profile_name: "", text: "" });
  const msgEndRef = useRef(null);
  const pollRef = useRef(null);

  const loadLeads = async () => {
    const r = await api.get("/leads");
    setLeads(r.data);
  };
  const loadConvos = async () => {
    const r = await api.get("/whatsapp/conversations");
    setConvos(r.data);
  };
  const loadMessages = async (waId) => {
    if (!waId) return;
    const r = await api.get(`/whatsapp/conversations/${waId}/messages`);
    setMessages(r.data);
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  useEffect(() => {
    loadLeads();
    loadConvos();
  }, []);

  // Poll every 8s to pick up new incoming messages
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadConvos();
      if (activeWa) loadMessages(activeWa);
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, [activeWa]);

  useEffect(() => {
    if (activeWa) loadMessages(activeWa);
  }, [activeWa]);

  // Merge leads + convos into a single sidebar list keyed by mobile
  const items = useMemo(() => {
    const byMobile = new Map();
    // seed from convos (has last_message, unread, last_at)
    for (const c of convos) {
      byMobile.set(c.wa_id, {
        wa_id: c.wa_id,
        name: c.lead_name || c.profile_name || c.wa_id,
        stage: c.stage || "Lead",
        location: c.location || "",
        event_date: c.event_date || null,
        last_message: c.last_message,
        last_at: c.last_at,
        unread: c.unread || 0,
        has_chat: true,
        lead_id: c.lead_id,
      });
    }
    // add leads that don't yet have a chat
    for (const l of leads) {
      const wa = (l.mobile || "").replace(/\D/g, "");
      if (!wa) continue;
      if (byMobile.has(wa)) {
        // enrich (some fields authoritative from lead)
        const cur = byMobile.get(wa);
        cur.name = l.name || cur.name;
        cur.stage = l.stage || cur.stage;
        cur.location = l.location || cur.location;
        cur.event_date = l.event_date || cur.event_date;
        cur.lead_id = l.id;
      } else {
        byMobile.set(wa, {
          wa_id: wa,
          name: l.name,
          stage: l.stage,
          location: l.location || "",
          event_date: l.event_date,
          last_message: l.notes || "",
          last_at: l.created_at,
          unread: 0,
          has_chat: false,
          lead_id: l.id,
        });
      }
    }
    let arr = Array.from(byMobile.values());
    if (stageFilter !== "All") arr = arr.filter((x) => x.stage === stageFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(
        (x) => x.name?.toLowerCase().includes(q) || x.wa_id?.includes(q)
      );
    }
    arr.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
    return arr;
  }, [leads, convos, search, stageFilter]);

  const activeItem = items.find((i) => i.wa_id === activeWa) ||
    convos.find((c) => c.wa_id === activeWa);

  const send = async () => {
    if (!draft.trim() || !activeWa) return;
    setSending(true);
    try {
      await api.post("/whatsapp/send", { wa_id: activeWa, text: draft.trim(), type: "text" });
      setDraft("");
      await loadMessages(activeWa);
      await loadConvos();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const changeStage = async (stage) => {
    if (!activeItem?.lead_id) return;
    try {
      await api.patch(`/leads/${activeItem.lead_id}/stage`, { stage });
      toast.success(`Stage → ${stage}`);
      loadLeads();
      loadConvos();
    } catch (e) {
      toast.error("Failed");
    }
  };

  const submitLead = async (e) => {
    e.preventDefault();
    await api.post("/leads", form);
    toast.success("Lead added");
    setShowLeadForm(false);
    setForm(emptyLead);
    loadLeads();
    loadConvos();
  };

  const sendMockIncoming = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/whatsapp/mock/incoming", mock);
      toast.success(`Auto-created lead: ${r.data.lead.name}`);
      setShowMock(false);
      setMock({ wa_id: "", profile_name: "", text: "" });
      await loadLeads();
      await loadConvos();
      setActiveWa(r.data.lead.mobile);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  const delLead = async (id) => {
    if (!window.confirm("Delete this lead? Chat history is preserved.")) return;
    await api.delete(`/leads/${id}`);
    loadLeads();
  };

  return (
    <div className="space-y-4" data-testid="pipeline-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-1">Leads · WhatsApp Chat</p>
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tighter text-black">Pipeline</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            data-testid="mock-incoming-btn"
            onClick={() => setShowMock(true)}
            className="border border-black/10 text-black rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 hover:bg-black/5"
            title="Simulate an incoming WhatsApp message (dev)"
          >
            <MessageCircle size={14} /> Simulate WA
          </button>
          <button
            data-testid="new-lead-btn"
            onClick={() => setShowLeadForm(true)}
            className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-5 py-2 text-sm font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"
          >
            <Plus size={14} /> New Lead
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-0 bg-white border border-black/10 rounded-3xl overflow-hidden h-[calc(100vh-220px)] min-h-[500px]">
        {/* LEFT: leads list */}
        <div className={`border-r border-black/10 flex flex-col ${activeWa ? "hidden md:flex" : "flex"}`}>
          {/* Search + Filter */}
          <div className="p-3 border-b border-black/5 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
              <input
                data-testid="lead-search"
                placeholder="Search name or number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-full border border-black/10 focus:border-[#E63946] outline-none"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
              {["All", ...STAGES].map((s) => (
                <button
                  key={s}
                  data-testid={`filter-${s}`}
                  onClick={() => setStageFilter(s)}
                  className={`px-3 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                    stageFilter === s ? "bg-black text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 && (
              <div className="p-6 text-center text-sm text-black/40">No leads yet.</div>
            )}
            {items.map((it) => (
              <button
                key={it.wa_id}
                data-testid={`lead-item-${it.wa_id}`}
                onClick={() => setActiveWa(it.wa_id)}
                className={`w-full text-left px-4 py-3 border-b border-black/5 flex gap-3 items-start hover:bg-black/[0.02] ${
                  activeWa === it.wa_id ? "bg-red-50/50" : ""
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E63946] to-[#8B0000] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {initials(it.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-sm text-black truncate">{it.name}</p>
                    <span className="text-[10px] text-black/40 flex-shrink-0">{formatTime(it.last_at)}</span>
                  </div>
                  <p className="text-xs text-black/50 truncate">{it.last_message || it.wa_id}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${stageColors[it.stage] || "bg-slate-100 text-slate-700"}`}>
                      {it.stage}
                    </span>
                    {it.unread > 0 && (
                      <span className="ml-auto text-[10px] bg-[#E63946] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                        {it.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: chat panel */}
        <div className={`flex flex-col ${activeWa ? "flex" : "hidden md:flex"}`}>
          {!activeWa ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#F8F9FA]">
              <div className="w-20 h-20 rounded-full bg-white shadow-md flex items-center justify-center mb-4">
                <MessageCircle size={32} className="text-[#E63946]" />
              </div>
              <h3 className="font-display text-xl font-bold text-black">Select a lead</h3>
              <p className="text-sm text-black/50 mt-1 max-w-xs">
                Pick a conversation from the left to view WhatsApp chat. New incoming messages auto-create leads.
              </p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-black/5 flex items-center gap-3 bg-white">
                <button
                  data-testid="back-to-list"
                  onClick={() => setActiveWa(null)}
                  className="md:hidden p-1 rounded hover:bg-black/5"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E63946] to-[#8B0000] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {initials(activeItem?.name || activeItem?.lead_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-black truncate">{activeItem?.name || activeItem?.lead_name}</p>
                  <p className="text-xs text-black/50 flex items-center gap-1">
                    <Phone size={10} /> +{activeWa}
                  </p>
                </div>
                <select
                  data-testid="active-stage"
                  value={activeItem?.stage || "Lead"}
                  onChange={(e) => changeStage(e.target.value)}
                  className={`text-[10px] font-bold px-2 py-1 rounded-full border-0 outline-none cursor-pointer ${
                    stageColors[activeItem?.stage || "Lead"]
                  }`}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Info bar */}
              {(activeItem?.location || activeItem?.event_date) && (
                <div className="px-4 py-2 bg-red-50/40 border-b border-red-100 flex flex-wrap gap-3 text-xs">
                  {activeItem?.event_date && (
                    <span className="flex items-center gap-1 text-black/70">
                      <CalIcon size={11} className="text-[#E63946]" />
                      <b>{activeItem.event_date}</b>
                    </span>
                  )}
                  {activeItem?.location && (
                    <span className="flex items-center gap-1 text-black/70">
                      <MapPin size={11} className="text-[#E63946]" />
                      {activeItem.location}
                    </span>
                  )}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#ECE5DD]/40 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat" data-testid="chat-messages">
                {messages.length === 0 && (
                  <div className="text-center text-xs text-black/40 py-10">No messages yet.</div>
                )}
                <AnimatePresence>
                  {messages.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          m.direction === "out"
                            ? "bg-[#DCF8C6] text-black rounded-br-sm"
                            : "bg-white text-black rounded-bl-sm"
                        }`}
                      >
                        {m.type === "image" && m.media_url && (
                          <img src={m.media_url} alt="attachment" className="rounded-lg mb-1 max-w-full" />
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className="text-[9px] text-black/40 text-right mt-1">
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={msgEndRef} />
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-black/5 bg-white flex gap-2 items-end">
                <textarea
                  data-testid="chat-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Type a message..."
                  className="flex-1 resize-none border border-black/10 rounded-2xl px-4 py-2 text-sm focus:border-[#E63946] outline-none max-h-32"
                />
                <button
                  data-testid="send-btn"
                  disabled={sending || !draft.trim()}
                  onClick={send}
                  className="bg-[#E63946] disabled:opacity-40 text-white rounded-full p-3 shadow-md shadow-red-500/20 hover:bg-[#D90429]"
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Lead modal */}
      {showLeadForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submitLead} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <h2 className="font-display text-2xl font-bold">New Lead</h2>
            <input required placeholder="Name" data-testid="l-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required placeholder="Mobile (with country code, e.g. 919845012345)" data-testid="l-mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <select data-testid="l-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select data-testid="l-stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input placeholder="Location" data-testid="l-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input type="date" placeholder="Event Date" data-testid="l-date" value={form.event_date || ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input placeholder="Theme" data-testid="l-theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <textarea placeholder="Notes" data-testid="l-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowLeadForm(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-lead" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Simulate incoming modal */}
      {showMock && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={sendMockIncoming} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <div>
              <h2 className="font-display text-2xl font-bold">Simulate WhatsApp Incoming</h2>
              <p className="text-xs text-black/50 mt-1">Test the auto-lead creation flow. Once Meta credentials are plugged in, real messages will land here automatically.</p>
            </div>
            <input required placeholder="Phone (with country code, e.g. 919845012345)" data-testid="mock-wa" value={mock.wa_id} onChange={(e) => setMock({ ...mock, wa_id: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input placeholder="Sender name (optional)" data-testid="mock-name" value={mock.profile_name} onChange={(e) => setMock({ ...mock, profile_name: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <textarea required placeholder="Message text..." data-testid="mock-text" value={mock.text} onChange={(e) => setMock({ ...mock, text: e.target.value })} rows={3} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowMock(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-mock" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">Send</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
