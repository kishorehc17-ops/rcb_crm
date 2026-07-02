import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, Edit3, Trash2, X, CheckCircle2 } from "lucide-react";

const empty = { name: "", price: 0, decorations: [], max_addons: 0, active: true };

export default function Packages() {
  const [pkgs, setPkgs] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [decoText, setDecoText] = useState("");

  const load = () => api.get("/packages").then((r) => setPkgs(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form, price: Number(form.price), max_addons: Number(form.max_addons),
      decorations: decoText.split("\n").map((s) => s.trim()).filter(Boolean) };
    if (editingId) {
      await api.put(`/packages/${editingId}`, payload);
      toast.success("Package updated");
    } else {
      await api.post("/packages", payload);
      toast.success("Package created");
    }
    setShow(false); setForm(empty); setEditingId(null); setDecoText("");
    load();
  };

  const edit = (p) => {
    setForm({ ...p });
    setDecoText((p.decorations || []).join("\n"));
    setEditingId(p.id); setShow(true);
  };

  const del = async (id) => {
    if (!window.confirm("Delete package?")) return;
    await api.delete(`/packages/${id}`);
    toast.success("Deleted"); load();
  };

  const gradients = [
    "from-white to-[#F8F9FA]",
    "from-yellow-50 to-white",
    "from-[#FFE5E8] to-white",
    "from-black to-[#1F1F1F] text-white",
  ];

  return (
    <div className="space-y-6" data-testid="packages-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Packages</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Package Management</h1>
        </div>
        <button data-testid="new-package-btn" onClick={() => { setForm(empty); setDecoText(""); setEditingId(null); setShow(true); }} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20 active:scale-95 transition-all">
          <Plus size={18} /> New Package
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {pkgs.map((p, i) => {
          const isDark = i === 3;
          return (
            <div key={p.id} className={`bg-gradient-to-br ${gradients[i % 4]} border ${isDark ? "border-black" : "border-black/5"} rounded-3xl p-6 shadow-sm hover:shadow-xl hover:shadow-red-500/10 hover:-translate-y-1 transition-all duration-300 flex flex-col`}>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${isDark ? "text-white/60" : "text-[#E63946]"}`}>{p.active ? "Active" : "Inactive"}</p>
                  <h3 className={`font-display text-2xl font-black tracking-tight ${isDark ? "text-white" : "text-black"}`}>{p.name}</h3>
                </div>
                <div className="flex gap-1">
                  <button data-testid={`edit-pkg-${p.id}`} onClick={() => edit(p)} className={`p-2 rounded-lg ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5"}`}><Edit3 size={14} /></button>
                  <button data-testid={`del-pkg-${p.id}`} onClick={() => del(p.id)} className={`p-2 rounded-lg ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-red-50 text-[#E63946]"}`}><Trash2 size={14} /></button>
                </div>
              </div>
              <p className={`font-display text-4xl font-black tracking-tighter ${isDark ? "text-white" : "text-black"} mb-4`}>
                ₹{Number(p.price).toLocaleString("en-IN")}
              </p>
              <ul className={`space-y-2 text-sm flex-1 ${isDark ? "text-white/80" : "text-black/70"}`}>
                {(p.decorations || []).map((d, idx) => (
                  <li key={idx} className="flex gap-2 items-start"><CheckCircle2 size={14} className={isDark ? "text-white flex-shrink-0 mt-0.5" : "text-[#E63946] flex-shrink-0 mt-0.5"} /> {d}</li>
                ))}
              </ul>
              <p className={`text-xs font-semibold mt-4 ${isDark ? "text-white/60" : "text-black/50"}`}>Up to {p.max_addons} add-ons</p>
            </div>
          );
        })}
      </div>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-2xl font-bold tracking-tight">{editingId ? "Edit" : "New"} Package</h2>
              <button onClick={() => setShow(false)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Name *</label>
                <input required data-testid="pkg-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Price (₹) *</label>
                <input required type="number" data-testid="pkg-price" value={form.price} onChange={(e) => setForm({...form, price: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Decorations (one per line)</label>
                <textarea data-testid="pkg-deco" rows={5} value={decoText} onChange={(e) => setDecoText(e.target.value)} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Max Add-ons</label>
                <input type="number" data-testid="pkg-addons" value={form.max_addons} onChange={(e) => setForm({...form, max_addons: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" data-testid="pkg-active" checked={form.active} onChange={(e) => setForm({...form, active: e.target.checked})} />
                <span className="text-sm font-semibold">Active (visible in booking form)</span>
              </label>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShow(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
                <button type="submit" data-testid="submit-pkg" className="px-6 py-3 rounded-full bg-[#E63946] hover:bg-[#D90429] text-white font-semibold shadow-md shadow-red-500/20 active:scale-95">{editingId ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
