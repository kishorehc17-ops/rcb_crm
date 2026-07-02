import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, Trash2, Edit3 } from "lucide-react";

const empty = { name: "", phone: "", address: "", gst: "", active: true };

export default function Vendors() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);

  const load = () => api.get("/vendors").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (editingId) await api.put(`/vendors/${editingId}`, form);
    else await api.post("/vendors", form);
    toast.success(editingId ? "Updated" : "Vendor added");
    setShow(false); setForm(empty); setEditingId(null); load();
  };

  const edit = (v) => { setForm({ ...v }); setEditingId(v.id); setShow(true); };
  const del = async (id) => { if (!window.confirm("Delete?")) return; await api.delete(`/vendors/${id}`); load(); };

  return (
    <div className="space-y-6" data-testid="vendors-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Vendors</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Vendor Directory</h1>
        </div>
        <button data-testid="new-vendor-btn" onClick={() => { setForm(empty); setEditingId(null); setShow(true); }} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> Add Vendor</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 && <p className="col-span-full text-center py-12 text-black/50">No vendors yet.</p>}
        {rows.map((v) => (
          <div key={v.id} className="bg-white border border-black/5 rounded-3xl p-5 shadow-sm hover:shadow-lg hover:shadow-red-500/5 hover:-translate-y-1 transition-all">
            <div className="flex justify-between items-start">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-black truncate">{v.name}</h3>
                <p className="text-sm text-black/60">{v.phone}</p>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${v.active ? "bg-green-100 text-green-700" : "bg-black/10 text-black/50"}`}>{v.active ? "Active" : "Inactive"}</span>
            </div>
            <p className="text-xs text-black/50 mt-2 truncate">{v.address}</p>
            {v.gst && <p className="text-xs text-black/50 mt-1">GST: {v.gst}</p>}
            <div className="flex gap-1 mt-3">
              <button data-testid={`edit-v-${v.id}`} onClick={() => edit(v)} className="p-2 rounded-lg hover:bg-black/5"><Edit3 size={14} /></button>
              <button data-testid={`del-v-${v.id}`} onClick={() => del(v.id)} className="p-2 rounded-lg hover:bg-red-50 text-[#E63946]"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 space-y-3">
            <h2 className="font-display text-2xl font-bold">{editingId ? "Edit" : "New"} Vendor</h2>
            <input required placeholder="Name" data-testid="v-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required placeholder="Phone" data-testid="v-phone" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input placeholder="Address" data-testid="v-addr" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input placeholder="GST Number" data-testid="v-gst" value={form.gst} onChange={(e) => setForm({...form, gst: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <label className="flex gap-2 items-center"><input type="checkbox" checked={form.active} onChange={(e) => setForm({...form, active: e.target.checked})} /> Active</label>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShow(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-vendor" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">{editingId ? "Update" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
