import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, X, ChevronRight, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";

const STAGES = ["Lead", "Contacted", "Quotation Sent", "Negotiation", "Booked", "Completed", "Review Received"];
const SOURCES = ["Meta Ads", "Website", "WhatsApp", "Manual"];

const empty = { name: "", mobile: "", source: "Manual", stage: "Lead", notes: "", event_date: "", theme: "" };

export default function Pipeline() {
  const [leads, setLeads] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);

  const load = () => api.get("/leads").then((r) => setLeads(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    await api.post("/leads", form);
    toast.success("Lead added");
    setShow(false); setForm(empty); load();
  };

  const advance = async (l) => {
    const idx = STAGES.indexOf(l.stage);
    if (idx < STAGES.length - 1) {
      await api.patch(`/leads/${l.id}/stage`, { stage: STAGES[idx + 1] });
      toast.success(`Moved to ${STAGES[idx + 1]}`);
      load();
    }
  };

  const del = async (id) => { if (!window.confirm("Delete lead?")) return; await api.delete(`/leads/${id}`); load(); };

  const wa = (l) => {
    const num = l.mobile.replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(`Hi ${l.name}, this is RCB Events.`)}`, "_blank");
  };

  return (
    <div className="space-y-6" data-testid="pipeline-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">CRM Pipeline</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Leads → Bookings</h1>
        </div>
        <button data-testid="new-lead-btn" onClick={() => setShow(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> New Lead</button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
        {STAGES.map((stage, si) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage} data-testid={`col-${stage}`} className="bg-[#F8F9FA] rounded-2xl p-4 flex flex-col gap-3 min-w-[280px] w-72 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-sm text-black">{stage}</h3>
                <span className="text-[10px] font-bold uppercase tracking-widest bg-white text-black/60 px-2 py-1 rounded-full">{items.length}</span>
              </div>
              <div className="space-y-2 min-h-[100px]">
                {items.map((l, i) => (
                  <motion.div
                    key={l.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white border border-black/5 rounded-xl p-3 shadow-sm hover:border-red-500/30 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-semibold text-black text-sm">{l.name}</p>
                      <button data-testid={`del-lead-${l.id}`} onClick={() => del(l.id)} className="p-1 rounded hover:bg-red-50 text-black/30 hover:text-[#E63946]"><X size={12} /></button>
                    </div>
                    <p className="text-xs text-black/60">{l.mobile}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#E63946] mt-1">{l.source}</p>
                    {l.notes && <p className="text-xs text-black/70 mt-2 line-clamp-2">{l.notes}</p>}
                    <div className="flex gap-1 mt-2">
                      <button data-testid={`wa-lead-${l.id}`} onClick={() => wa(l)} className="flex-1 bg-green-50 text-green-700 rounded-lg py-1.5 text-[10px] font-semibold flex items-center justify-center gap-1"><MessageCircle size={10} /> WA</button>
                      {si < STAGES.length - 1 && (
                        <button data-testid={`advance-lead-${l.id}`} onClick={() => advance(l)} className="flex-1 bg-black text-white rounded-lg py-1.5 text-[10px] font-semibold flex items-center justify-center gap-1">Next <ChevronRight size={10} /></button>
                      )}
                    </div>
                  </motion.div>
                ))}
                {items.length === 0 && <div className="text-xs text-black/30 text-center py-6">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 space-y-3">
            <h2 className="font-display text-2xl font-bold">New Lead</h2>
            <input required placeholder="Name" data-testid="l-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required placeholder="Mobile" data-testid="l-mobile" value={form.mobile} onChange={(e) => setForm({...form, mobile: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <select data-testid="l-source" value={form.source} onChange={(e) => setForm({...form, source: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select data-testid="l-stage" value={form.stage} onChange={(e) => setForm({...form, stage: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input placeholder="Theme" data-testid="l-theme" value={form.theme} onChange={(e) => setForm({...form, theme: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <textarea placeholder="Notes" data-testid="l-notes" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} rows={3} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShow(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-lead" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
