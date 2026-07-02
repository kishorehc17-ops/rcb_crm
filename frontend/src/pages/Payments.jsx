import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, Wallet } from "lucide-react";

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ booking_id: "", amount: 0, method: "Cash", note: "" });

  const load = async () => {
    const [p, b] = await Promise.all([api.get("/payments"), api.get("/bookings")]);
    setPayments(p.data); setBookings(b.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    await api.post("/payments", { ...form, amount: Number(form.amount) });
    toast.success("Payment recorded");
    setShow(false);
    setForm({ booking_id: "", amount: 0, method: "Cash", note: "" });
    load();
  };

  const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPending = bookings.reduce((s, b) => s + (Number(b.total_amount || 0) - Number(b.advance_paid || 0)), 0);

  const bookingName = (id) => bookings.find((b) => b.id === id)?.customer_name || "—";

  return (
    <div className="space-y-6" data-testid="payments-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Payments</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Customer Payments</h1>
        </div>
        <button data-testid="new-payment-btn" onClick={() => setShow(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> Record Payment</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm">
          <div className="w-11 h-11 rounded-2xl bg-[#E63946] text-white flex items-center justify-center mb-3"><Wallet size={20} /></div>
          <p className="text-xs font-bold uppercase tracking-widest text-black/60">Total Collected</p>
          <p className="font-display text-4xl font-black tracking-tighter">₹{totalCollected.toLocaleString("en-IN")}</p>
        </div>
        <div className="bg-black text-white rounded-3xl p-6 shadow-lg">
          <div className="w-11 h-11 rounded-2xl bg-white text-black flex items-center justify-center mb-3"><Wallet size={20} /></div>
          <p className="text-xs font-bold uppercase tracking-widest opacity-70">Total Pending</p>
          <p className="font-display text-4xl font-black tracking-tighter">₹{totalPending.toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-black/[0.02] text-xs uppercase tracking-widest text-black/50">
            <tr>
              <th className="text-left px-6 py-4">Date</th>
              <th className="text-left px-6 py-4">Customer</th>
              <th className="text-left px-6 py-4">Method</th>
              <th className="text-right px-6 py-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={4} className="text-center py-12 text-black/50">No payments recorded.</td></tr>}
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-black/5">
                <td className="px-6 py-4 text-sm text-black/70">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4 font-semibold">{bookingName(p.booking_id)}</td>
                <td className="px-6 py-4"><span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-black/5">{p.method}</span></td>
                <td className="px-6 py-4 text-right font-bold text-[#E63946]">₹{Number(p.amount).toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 space-y-4">
            <h2 className="font-display text-2xl font-bold">Record Payment</h2>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Booking *</label>
              <select required data-testid="pay-booking" value={form.booking_id} onChange={(e) => setForm({...form, booking_id: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none">
                <option value="">Select booking</option>
                {bookings.map((b) => <option key={b.id} value={b.id}>{b.booking_number} — {b.customer_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Amount (₹) *</label>
              <input required type="number" data-testid="pay-amount" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Method</label>
              <select data-testid="pay-method" value={form.method} onChange={(e) => setForm({...form, method: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none">
                <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">Note</label>
              <input data-testid="pay-note" value={form.note} onChange={(e) => setForm({...form, note: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-[#E63946] focus:outline-none" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShow(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-payment" className="px-6 py-3 rounded-full bg-[#E63946] hover:bg-[#D90429] text-white font-semibold">Record</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
