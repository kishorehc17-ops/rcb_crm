import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/api";
import { toast } from "sonner";
import {
  Plus, X, Search, Send, MessageCircle, MapPin, Calendar as CalIcon,
  ChevronLeft, Phone, Package as PkgIcon, Link2, QrCode, FileText, UserPlus,
  StickyNote, CheckCheck, Check, AlertTriangle, Paperclip,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STAGES = ["Lead", "Contacted", "Quotation Sent", "Negotiation", "Booked", "Completed", "Review Received"];
const SOURCES = ["Meta Ads", "Website", "WhatsApp", "Manual"];
const emptyLead = { name: "", mobile: "", source: "Manual", stage: "Lead", notes: "", event_date: "", theme: "", location: "" };

function initials(name = "") {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
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

const MsgStatusIcon = ({ status }) => {
  if (status === "read") return <CheckCheck size={12} className="text-blue-500" />;
  if (status === "delivered") return <CheckCheck size={12} className="text-black/40" />;
  if (status === "failed") return <AlertTriangle size={12} className="text-red-500" />;
  return <Check size={12} className="text-black/40" />;
};

export default function Pipeline() {
  const nav = useNavigate();
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
  const [pkgPicker, setPkgPicker] = useState(false);
  const [packages, setPackages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [reviewUrl, setReviewUrl] = useState("");
  const [showProfile, setShowProfile] = useState(false); // mobile toggle
  const msgEndRef = useRef(null);
  const pollRef = useRef(null);

  const loadLeads = async () => setLeads((await api.get("/leads")).data);
  const loadConvos = async () => setConvos((await api.get("/whatsapp/conversations")).data);
  const loadBookings = async () => setBookings((await api.get("/bookings")).data);
  const loadMessages = async (waId) => {
    if (!waId) return;
    const r = await api.get(`/whatsapp/conversations/${waId}/messages`);
    setMessages(r.data);
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 40);
  };

  useEffect(() => {
    loadLeads();
    loadConvos();
    loadBookings();
    api.get("/packages", { params: { active_only: true } }).then((r) => setPackages(r.data));
    api.get("/config/review-url").then((r) => setReviewUrl(r.data.google_review_url)).catch(() => {});
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadConvos();
      loadBookings();
      if (activeWa) loadMessages(activeWa);
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, [activeWa]);

  useEffect(() => {
    if (activeWa) loadMessages(activeWa);
  }, [activeWa]);

  // Merge leads + convos
  const items = useMemo(() => {
    const byMobile = new Map();
    for (const c of convos) {
      byMobile.set(c.wa_id, {
        wa_id: c.wa_id, name: c.lead_name || c.profile_name || c.wa_id,
        stage: c.stage || "Lead", location: c.location || "",
        event_date: c.event_date || null, last_message: c.last_message,
        last_at: c.last_at, unread: c.unread || 0, has_chat: true,
        lead_id: c.lead_id, profile_name: c.profile_name,
      });
    }
    for (const l of leads) {
      const wa = (l.mobile || "").replace(/\D/g, "");
      if (!wa) continue;
      if (byMobile.has(wa)) {
        const cur = byMobile.get(wa);
        cur.name = l.name || cur.name;
        cur.stage = l.stage || cur.stage;
        cur.location = l.location || cur.location;
        cur.event_date = l.event_date || cur.event_date;
        cur.lead_id = l.id;
        cur.notes = l.notes;
      } else {
        byMobile.set(wa, {
          wa_id: wa, name: l.name, stage: l.stage,
          location: l.location || "", event_date: l.event_date,
          last_message: l.notes || "", last_at: l.created_at,
          unread: 0, has_chat: false, lead_id: l.id, notes: l.notes,
        });
      }
    }
    let arr = Array.from(byMobile.values());
    if (stageFilter !== "All") arr = arr.filter((x) => x.stage === stageFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((x) => x.name?.toLowerCase().includes(q) || x.wa_id?.includes(q));
    }
    arr.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
    return arr;
  }, [leads, convos, search, stageFilter]);

  const activeItem = items.find((i) => i.wa_id === activeWa);
  const activeBooking = useMemo(
    () => bookings.find((b) => (b.mobile || "").replace(/\D/g, "") === activeWa),
    [bookings, activeWa]
  );

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
    } catch { toast.error("Failed"); }
  };

  const saveNotes = async (notes) => {
    if (!activeItem?.lead_id) return;
    try {
      await api.put(`/leads/${activeItem.lead_id}`, {
        name: activeItem.name, mobile: activeItem.wa_id,
        stage: activeItem.stage, source: "WhatsApp",
        notes, event_date: activeItem.event_date || null,
        theme: "", location: activeItem.location || "",
      });
      toast.success("Notes saved");
      loadLeads();
    } catch { toast.error("Failed to save notes"); }
  };

  const submitLead = async (e) => {
    e.preventDefault();
    await api.post("/leads", form);
    toast.success("Lead added");
    setShowLeadForm(false);
    setForm(emptyLead);
    loadLeads(); loadConvos();
  };

  const sendMockIncoming = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/whatsapp/mock/incoming", mock);
      toast.success(`Auto-created lead: ${r.data.lead.name}`);
      setShowMock(false); setMock({ wa_id: "", profile_name: "", text: "" });
      await loadLeads(); await loadConvos();
      setActiveWa(r.data.lead.mobile);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  // Quick actions
  const createBooking = () => {
    if (!activeItem) return;
    nav(`/bookings?new=1&prefill_mobile=${encodeURIComponent(activeItem.wa_id)}&prefill_name=${encodeURIComponent(activeItem.name || "")}`);
  };
  const openBooking = () => { if (activeBooking) nav(`/bookings?highlight=${activeBooking.id}`); };
  const openInvoice = () => { if (activeBooking) nav(`/invoice/${activeBooking.id}`); };
  const sendAdvanceLink = async () => {
    if (!activeBooking) return toast.error("No booking yet — create one first");
    let url = activeBooking.advance_link_url;
    if (!url) {
      try {
        const r = await api.post(`/bookings/${activeBooking.id}/regenerate-advance-link`);
        url = r.data.url;
      } catch (e) { toast.error(e.response?.data?.detail || "Link unavailable"); return; }
    }
    const msg = `Hi ${activeBooking.customer_name}, please pay the advance ₹${Number(activeBooking.advance_amount || 2000).toLocaleString("en-IN")} for booking ${activeBooking.booking_number}: ${url}`;
    setDraft(msg);
    toast.info("Message prepared — click Send");
  };
  const sendBalanceQR = async () => {
    if (!activeBooking) return toast.error("No booking yet");
    let payUrl = activeBooking.balance_qr_payment_url;
    if (!payUrl) {
      try {
        const r = await api.post(`/bookings/${activeBooking.id}/generate-balance-qr`);
        payUrl = r.data.payment_url;
      } catch (e) { toast.error(e.response?.data?.detail || "QR unavailable"); return; }
    }
    const balance = Number(activeBooking.total_amount) - Number(activeBooking.advance_paid);
    const msg = `Hi ${activeBooking.customer_name}, please pay balance ₹${balance.toLocaleString("en-IN")} for booking ${activeBooking.booking_number}: ${payUrl}`;
    setDraft(msg);
    toast.info("Message prepared — click Send");
  };
  const sendPackage = async (pkg) => {
    setPkgPicker(false);
    try {
      await api.post("/whatsapp/send-package", { wa_id: activeWa, package_id: pkg.id });
      toast.success(`Sent: ${pkg.name}`);
      loadMessages(activeWa); loadConvos();
    } catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
  };

  return (
    <div className="space-y-3" data-testid="pipeline-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-1">Leads · WhatsApp CRM</p>
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tighter text-black">Pipeline</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button data-testid="mock-incoming-btn" onClick={() => setShowMock(true)} className="border border-black/10 text-black rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 hover:bg-black/5">
            <MessageCircle size={14} /> Simulate WA
          </button>
          <button data-testid="new-lead-btn" onClick={() => setShowLeadForm(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-5 py-2 text-sm font-semibold flex items-center gap-2 shadow-md shadow-red-500/20">
            <Plus size={14} /> New Lead
          </button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)_320px] gap-0 bg-white border border-black/10 rounded-3xl overflow-hidden h-[calc(100vh-220px)] min-h-[540px]">

        {/* LEFT: Conversation list */}
        <div className={`border-r border-black/10 flex flex-col ${activeWa ? "hidden md:flex" : "flex"}`}>
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
                  key={s} onClick={() => setStageFilter(s)} data-testid={`filter-${s}`}
                  className={`px-3 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                    stageFilter === s ? "bg-black text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 && <div className="p-6 text-center text-sm text-black/40">No leads yet.</div>}
            {items.map((it) => (
              <button
                key={it.wa_id} data-testid={`lead-item-${it.wa_id}`}
                onClick={() => { setActiveWa(it.wa_id); setShowProfile(false); }}
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
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${stageColors[it.stage] || "bg-slate-100 text-slate-700"}`}>{it.stage}</span>
                    {it.unread > 0 && (
                      <span className="ml-auto text-[10px] bg-[#E63946] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">{it.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* CENTER: Chat panel */}
        <div className={`flex flex-col ${activeWa ? "flex" : "hidden md:flex"} ${showProfile ? "hidden md:flex" : ""}`}>
          {!activeWa ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#F8F9FA]">
              <div className="w-20 h-20 rounded-full bg-white shadow-md flex items-center justify-center mb-4">
                <MessageCircle size={32} className="text-[#E63946]" />
              </div>
              <h3 className="font-display text-xl font-bold text-black">Select a conversation</h3>
              <p className="text-sm text-black/50 mt-1 max-w-xs">Pick a lead from the left. New WhatsApp messages auto-create leads.</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-black/5 flex items-center gap-3 bg-white">
                <button data-testid="back-to-list" onClick={() => setActiveWa(null)} className="md:hidden p-1 rounded hover:bg-black/5">
                  <ChevronLeft size={18} />
                </button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E63946] to-[#8B0000] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {initials(activeItem?.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-black truncate">{activeItem?.name}</p>
                  <p className="text-xs text-black/50 flex items-center gap-1"><Phone size={10} /> +{activeWa}</p>
                </div>
                <button data-testid="toggle-profile" onClick={() => setShowProfile(true)} className="md:hidden p-2 rounded-full hover:bg-black/5">
                  <UserPlus size={16} />
                </button>
                <select
                  data-testid="active-stage" value={activeItem?.stage || "Lead"}
                  onChange={(e) => changeStage(e.target.value)}
                  className={`hidden md:block text-[10px] font-bold px-2 py-1 rounded-full border-0 outline-none cursor-pointer ${stageColors[activeItem?.stage || "Lead"]}`}
                >
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Info bar */}
              {(activeItem?.location || activeItem?.event_date) && (
                <div className="px-4 py-2 bg-red-50/40 border-b border-red-100 flex flex-wrap gap-3 text-xs">
                  {activeItem?.event_date && <span className="flex items-center gap-1 text-black/70"><CalIcon size={11} className="text-[#E63946]" /><b>{activeItem.event_date}</b></span>}
                  {activeItem?.location && <span className="flex items-center gap-1 text-black/70"><MapPin size={11} className="text-[#E63946]" />{activeItem.location}</span>}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#ECE5DD]/40" data-testid="chat-messages" style={{ backgroundImage: "url(\"https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png\")" }}>
                {messages.length === 0 && <div className="text-center text-xs text-black/40 py-10">No messages yet.</div>}
                <AnimatePresence>
                  {messages.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        m.direction === "out" ? "bg-[#DCF8C6] text-black rounded-br-sm" : "bg-white text-black rounded-bl-sm"
                      }`}>
                        {m.type === "image" && m.media_url && (
                          <img src={m.media_url} alt="attachment" className="rounded-lg mb-1 max-w-full max-h-72 object-cover" />
                        )}
                        {m.type === "document" && m.media_url && (
                          <a href={m.media_url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 bg-white/60 rounded-lg px-2 py-1.5 border border-black/10 hover:bg-white">
                            <FileText size={16} className="text-[#E63946]" />
                            <span className="text-xs font-semibold truncate max-w-[180px]">Document</span>
                          </a>
                        )}
                        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <p className="text-[9px] text-black/40">{formatTime(m.created_at)}</p>
                          {m.direction === "out" && <MsgStatusIcon status={m.status} />}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={msgEndRef} />
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-black/5 bg-white flex gap-2 items-end">
                <button
                  data-testid="pkg-picker-btn"
                  onClick={() => setPkgPicker(true)}
                  className="p-2.5 rounded-full bg-black/5 hover:bg-black/10"
                  title="Send package"
                >
                  <PkgIcon size={16} />
                </button>
                <textarea
                  data-testid="chat-input" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={1} placeholder="Type a message..."
                  className="flex-1 resize-none border border-black/10 rounded-2xl px-4 py-2 text-sm focus:border-[#E63946] outline-none max-h-32"
                />
                <button
                  data-testid="send-btn" disabled={sending || !draft.trim()} onClick={send}
                  className="bg-[#E63946] disabled:opacity-40 text-white rounded-full p-3 shadow-md shadow-red-500/20 hover:bg-[#D90429]"
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* RIGHT: Customer profile */}
        <div className={`border-l border-black/10 bg-white flex-col overflow-y-auto ${activeWa && showProfile ? "flex" : (activeWa ? "hidden md:flex" : "hidden md:flex")}`}>
          {!activeWa ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-black/40">
              Customer details will appear here
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-black/5 flex items-center gap-3 md:hidden">
                <button onClick={() => setShowProfile(false)} className="p-1 rounded hover:bg-black/5"><ChevronLeft size={18} /></button>
                <p className="font-semibold text-sm">Customer</p>
              </div>
              <div className="p-5 text-center border-b border-black/5">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#E63946] to-[#8B0000] text-white flex items-center justify-center font-bold text-xl mx-auto mb-2">
                  {initials(activeItem?.name)}
                </div>
                <p className="font-display font-bold text-lg">{activeItem?.name}</p>
                <p className="text-xs text-black/50 flex items-center justify-center gap-1"><Phone size={10} /> +{activeWa}</p>
                <div className="mt-2 flex justify-center">
                  <select
                    value={activeItem?.stage || "Lead"}
                    onChange={(e) => changeStage(e.target.value)}
                    data-testid="profile-stage"
                    className={`text-[10px] font-bold px-2 py-1 rounded-full border-0 outline-none cursor-pointer ${stageColors[activeItem?.stage || "Lead"]}`}
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Booking details */}
              <div className="p-4 border-b border-black/5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Booking</p>
                {activeBooking ? (
                  <div className="space-y-1.5 text-xs">
                    <p className="font-mono text-black/70">{activeBooking.booking_number}</p>
                    <div className="flex gap-1 flex-wrap">
                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-black/5">{activeBooking.booking_status}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-black/5">{activeBooking.payment_status}</span>
                    </div>
                    {activeBooking.package_name && <p><b>Package:</b> {activeBooking.package_name}</p>}
                    {activeBooking.theme && <p><b>Theme:</b> {activeBooking.theme}</p>}
                    {activeBooking.event_date && <p><b>Date:</b> {activeBooking.event_date} · {activeBooking.event_time}</p>}
                    {activeBooking.location && <p><b>Venue:</b> {activeBooking.location}</p>}
                    <div className="grid grid-cols-3 gap-1 pt-2 text-center">
                      <div className="p-2 rounded-lg bg-black/[0.03]"><p className="text-[8px] uppercase text-black/40 font-bold">Total</p><p className="font-bold text-xs">₹{Number(activeBooking.total_amount).toLocaleString("en-IN")}</p></div>
                      <div className="p-2 rounded-lg bg-green-50"><p className="text-[8px] uppercase text-green-700 font-bold">Paid</p><p className="font-bold text-xs text-green-700">₹{Number(activeBooking.advance_paid).toLocaleString("en-IN")}</p></div>
                      <div className="p-2 rounded-lg bg-red-50"><p className="text-[8px] uppercase text-[#E63946] font-bold">Balance</p><p className="font-bold text-xs text-[#E63946]">₹{Math.max(0, Number(activeBooking.total_amount) - Number(activeBooking.advance_paid)).toLocaleString("en-IN")}</p></div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-black/40">No booking yet.</p>
                )}
              </div>

              {/* Quick actions */}
              <div className="p-4 border-b border-black/5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Quick actions</p>
                <div className="grid grid-cols-2 gap-2">
                  {!activeBooking ? (
                    <button onClick={createBooking} data-testid="qa-create-booking" className="col-span-2 bg-[#E63946] text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#D90429]">
                      <Plus size={12} /> Create Booking
                    </button>
                  ) : (
                    <button onClick={openBooking} data-testid="qa-open-booking" className="col-span-2 bg-black text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-black/80">
                      <FileText size={12} /> Open Booking
                    </button>
                  )}
                  <button onClick={() => setPkgPicker(true)} data-testid="qa-send-package" className="bg-blue-50 text-blue-700 rounded-xl py-2 text-[10px] font-bold flex items-center justify-center gap-1"><PkgIcon size={12} /> Send Package</button>
                  <button onClick={sendAdvanceLink} data-testid="qa-send-adv" disabled={!activeBooking} className="bg-yellow-50 text-yellow-700 rounded-xl py-2 text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"><Link2 size={12} /> Advance Link</button>
                  <button onClick={sendBalanceQR} data-testid="qa-send-qr" disabled={!activeBooking} className="bg-blue-50 text-blue-700 rounded-xl py-2 text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"><QrCode size={12} /> Send QR</button>
                  <button onClick={openInvoice} data-testid="qa-invoice" disabled={!activeBooking} className="bg-black/5 rounded-xl py-2 text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"><FileText size={12} /> Invoice</button>
                </div>
              </div>

              {/* Notes */}
              <NotesBox key={activeItem?.lead_id || activeWa} initial={activeItem?.notes || ""} onSave={saveNotes} />
            </>
          )}
        </div>
      </div>

      {/* Package picker */}
      {pkgPicker && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" data-testid="pkg-picker">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Send Package via WhatsApp</p>
                <h3 className="font-display text-xl font-bold">Pick a package</h3>
              </div>
              <button onClick={() => setPkgPicker(false)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            {packages.length === 0 ? (
              <p className="text-center py-8 text-sm text-black/40">No packages yet.</p>
            ) : (
              <div className="space-y-2">
                {packages.map((p) => (
                  <button key={p.id} data-testid={`send-pkg-${p.id}`} onClick={() => sendPackage(p)} className="w-full text-left border border-black/10 rounded-2xl p-3 hover:border-[#E63946] transition-all">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-black">{p.name}</p>
                        <p className="text-xs text-black/50">₹{Number(p.price).toLocaleString("en-IN")}</p>
                        {p.includes?.length > 0 && <p className="text-[10px] text-black/40 mt-1">Includes {p.includes.length} items</p>}
                      </div>
                      <Send size={14} className="text-[#E63946]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Lead */}
      {showLeadForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submitLead} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <h2 className="font-display text-2xl font-bold">New Lead</h2>
            <input required placeholder="Name" data-testid="l-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required placeholder="Mobile (e.g. 919845012345)" data-testid="l-mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <select data-testid="l-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select data-testid="l-stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input placeholder="Location" data-testid="l-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input type="date" data-testid="l-date" value={form.event_date || ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input placeholder="Theme" data-testid="l-theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <textarea placeholder="Notes" data-testid="l-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowLeadForm(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-lead" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Simulate incoming */}
      {showMock && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={sendMockIncoming} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <div>
              <h2 className="font-display text-2xl font-bold">Simulate WhatsApp Incoming</h2>
              <p className="text-xs text-black/50 mt-1">Test auto-lead creation. Once Deropo/Meta credentials are plugged in, real messages arrive automatically.</p>
            </div>
            <input required placeholder="Phone (e.g. 919845012345)" data-testid="mock-wa" value={mock.wa_id} onChange={(e) => setMock({ ...mock, wa_id: e.target.value })} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
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

const NotesBox = ({ initial, onSave }) => {
  const [val, setVal] = useState(initial || "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setVal(initial || ""); setDirty(false); }, [initial]);
  return (
    <div className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2 flex items-center gap-1"><StickyNote size={11} /> Internal notes</p>
      <textarea
        data-testid="internal-notes"
        value={val}
        onChange={(e) => { setVal(e.target.value); setDirty(true); }}
        rows={4}
        placeholder="Team-only notes about this customer..."
        className="w-full text-xs border border-black/10 rounded-xl px-3 py-2 resize-none focus:border-[#E63946] outline-none"
      />
      {dirty && (
        <button
          onClick={() => { onSave(val); setDirty(false); }}
          data-testid="save-notes"
          className="mt-2 w-full py-2 rounded-full bg-black text-white text-xs font-semibold hover:bg-black/80"
        >Save notes</button>
      )}
    </div>
  );
};
