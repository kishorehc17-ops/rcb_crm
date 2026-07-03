import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

const CATEGORIES = ["Vendor", "Staff", "Petrol", "Transportation", "Materials", "Food", "Other"];

export default function Expenses() {
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [staff, setStaff] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), category: "Materials", vendor_id: "", staff_id: "", amount: 0, remarks: "" });
  const [filter, setFilter] = useState("All");

  const load = async () => {
    const [e, v, s] = await Promise.all([api.get("/expenses"), api.get("/vendors"), api.get("/staff")]);
    setRows(e.data); setVendors(v.data); setStaff(s.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    await api.post("/expenses", { ...form, amount: Number(form.amount) });
    toast.success("Expense added");
    setShow(false);
    setForm({ date: new Date().toISOString().slice(0, 10), category: "Materials", vendor_id: "", staff_id: "", amount: 0, remarks: "" });
    load();
  };

  const del = async (id) => {
    if (!window.confirm("Delete expense?")) return;
    await api.delete(`/expenses/${id}`);
    load();
  };

  const filtered = filter === "All" ? rows : rows.filter((r) => r.category === filter);
  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="space-y-6" data-testid="expenses-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Expenses</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Expense Book</h1>
        </div>
        <button data-testid="new-expense-btn" onClick={() => setShow(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> Add Expense</button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {["All", ...CATEGORIES].map((c) => (
          <button key={c} data-testid={`exp-filter-${c}`} onClick={() => setFilter(c)} className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${filter === c ? "bg-black text-white" : "bg-white border border-black/10"}`}>{c}</button>
        ))}
      </div>

      <div className="bg-black text-white rounded-3xl p-6 shadow-lg">
        <p className="text-xs font-bold uppercase tracking-widest opacity-70">Total {filter !== "All" && `(${filter})`}</p>
        <p className="font-display text-4xl font-black tracking-tighter">₹{total.toLocaleString("en-IN")}</p>
      </div>

      <div className="bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-black/[0.02] text-xs uppercase tracking-widest text-black/50">
            <tr>
              <th className="text-left px-6 py-4">Date</th>
              <th className="text-left px-6 py-4">Category</th>
              <th className="text-left px-6 py-4">Party</th>
              <th className="text-left px-6 py-4">Remarks</th>
              <th className="text-right px-6 py-4">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-black/50">No expenses.</td></tr>}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-black/5">
                <td className="px-6 py-4 text-sm">{r.date}</td>
                <td className="px-6 py-4"><span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-[#FFE5E8] text-[#E63946]">{r.category}</span></td>
                <td className="px-6 py-4 text-sm">{vendors.find((v) => v.id === r.vendor_id)?.name || staff.find((s) => s.id === r.staff_id)?.name || "—"}</td>
                <td className="px-6 py-4 text-sm text-black/60">{r.remarks}</td>
                <td className="px-6 py-4 text-right font-bold">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                <td className="px-2"><button data-testid={`del-exp-${r.id}`} onClick={() => del(r.id)} className="p-2 rounded-lg hover:bg-red-50 text-[#E63946]"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <h2 className="font-display text-2xl font-bold">New Expense</h2>
            <input required type="date" data-testid="exp-date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <select data-testid="exp-cat" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            {form.category === "Vendor" && (
              <select data-testid="exp-vendor" value={form.vendor_id} onChange={(e) => setForm({...form, vendor_id: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
                <option value="">Select vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            {form.category === "Staff" && (
              <select data-testid="exp-staff" value={form.staff_id} onChange={(e) => setForm({...form, staff_id: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
                <option value="">Select staff</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input required type="number" data-testid="exp-amount" placeholder="Amount ₹" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <textarea data-testid="exp-remarks" placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({...form, remarks: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" rows={2} />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShow(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-expense" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
