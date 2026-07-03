import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import {
  Plus, Wallet, Link2, QrCode, MessageCircle, History, Copy, Printer, Download,
  RefreshCw, X, Search, FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const PAYMENT_STATUS_ORDER = ["Advance Pending", "Partial Paid", "Fully Paid"];

const paymentStatusColor = (s) => ({
  "Advance Pending": "bg-red-100 text-red-700",
  "Partial Paid": "bg-amber-100 text-amber-700",
  "Fully Paid": "bg-green-100 text-green-700",
}[s] || "bg-black/10 text-black");

const paymentStatusDot = (s) => ({
  "Advance Pending": "🔴",
  "Partial Paid": "🟠",
  "Fully Paid": "🟢",
}[s] || "");

export default function Payments() {
  const [bookings, setBookings] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ booking_id: "", amount: 0, method: "Cash", note: "" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [qrBooking, setQrBooking] = useState(null);
  const [historyBooking, setHistoryBooking] = useState(null);
  const [history, setHistory] = useState({ payments: [], totals: {} });

  const load = async () => {
    const b = await api.get("/bookings");
    setBookings(b.data);
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/payments", { ...form, amount: Number(form.amount) });
      toast.success("Payment recorded");
      setShow(false);
      setForm({ booking_id: "", amount: 0, method: "Cash", note: "" });
      load();
    } catch {
      toast.error("Failed to record");
    }
  };

  const totalCollected = bookings.reduce((s, b) => s + Number(b.advance_paid || 0), 0);
  const totalPending = bookings.reduce(
    (s, b) => s + Math.max(0, Number(b.total_amount || 0) - Number(b.advance_paid || 0)),
    0
  );

  const filtered = bookings.filter((b) => {
    const q = search.toLowerCase();
    const matchQ = !q || b.customer_name?.toLowerCase().includes(q) || b.mobile?.includes(q) || b.booking_number?.toLowerCase().includes(q);
    const status = b.payment_status || "Advance Pending";
    const matchS = statusFilter === "All" || status === statusFilter;
    return matchQ && matchS;
  });

  const sendAdvanceLink = async (b) => {
    try {
      let url = b.advance_link_url;
      if (!url) {
        const res = await api.post(`/bookings/${b.id}/regenerate-advance-link`);
        url = res.data.url;
      }
      const msg = encodeURIComponent(
        `Hi ${b.customer_name}, please pay the ₹${Number(b.advance_amount || 2000).toLocaleString("en-IN")} advance for booking ${b.booking_number}: ${url}`
      );
      const num = (b.mobile || "").replace(/\D/g, "");
      window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
      toast.success("Advance link sent");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const openQR = async (b) => {
    let bk = b;
    if (!b.balance_qr_url) {
      try {
        const res = await api.post(`/bookings/${b.id}/generate-balance-qr`);
        bk = { ...b, balance_qr_url: res.data.image_url, balance_qr_payment_url: res.data.payment_url };
        load();
      } catch (err) {
        toast.error(err.response?.data?.detail || "QR unavailable");
        return;
      }
    }
    setQrBooking(bk);
  };

  const openHistory = async (b) => {
    try {
      const res = await api.get(`/bookings/${b.id}/payment-history`);
      setHistory({ payments: res.data.payments, totals: res.data.totals });
      setHistoryBooking(b);
    } catch {
      toast.error("Failed to load history");
    }
  };

  const shareQR = (b) => {
    const url = b.balance_qr_payment_url || "";
    const balance = Number(b.total_amount) - Number(b.advance_paid);
    const msg = encodeURIComponent(
      `Hi ${b.customer_name}, please pay balance ₹${balance.toLocaleString("en-IN")} for ${b.booking_number}: ${url}`
    );
    const num = (b.mobile || "").replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
  };

  const downloadQR = (b) => {
    const a = document.createElement("a");
    a.href = b.balance_qr_url;
    a.download = `qr-${b.booking_number}.png`;
    a.click();
  };

  const printQR = (b) => {
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    const balance = Number(b.total_amount) - Number(b.advance_paid);
    w.document.write(`
      <html><head><title>QR - ${b.booking_number}</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:24px">
        <h2>RCB Events</h2>
        <p><b>${b.customer_name}</b><br/>${b.booking_number}</p>
        <img src="${b.balance_qr_url}" style="width:280px;height:280px"/>
        <h3>Balance: ₹${balance.toLocaleString("en-IN")}</h3>
        <p style="font-size:11px;color:#666">Scan to pay via UPI · Powered by Razorpay</p>
        <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  };

  const copyLink = (url) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Copied");
  };

  const syncPayment = async (b) => {
    try {
      const res = await api.post(`/payments/sync/${b.id}`);
      const st = res.data.statuses || {};
      const parts = [];
      if (st.advance_link) parts.push(`Advance: ${st.advance_link}`);
      if (st.balance_qr) parts.push(`Balance: ${st.balance_qr}`);
      if (res.data.reconciled > 0) {
        toast.success(`Synced ₹${res.data.reconciled} · ${parts.join(" · ")}`);
      } else {
        toast.info(parts.length ? parts.join(" · ") : "No links to sync");
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sync failed");
    }
  };

  const navigate = useNavigate();

  return (
    <div className="space-y-6" data-testid="payments-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Payments</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Customer Payments</h1>
        </div>
        <button data-testid="new-payment-btn" onClick={() => setShow(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> Record Cash Payment</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm">
          <div className="w-11 h-11 rounded-2xl bg-[#E63946] text-white flex items-center justify-center mb-3"><Wallet size={20} /></div>
          <p className="text-xs font-bold uppercase tracking-widest text-black/60">Total Collected</p>
          <p className="font-display text-4xl font-black tracking-tighter" data-testid="kpi-collected">₹{totalCollected.toLocaleString("en-IN")}</p>
        </div>
        <div className="bg-black text-white rounded-3xl p-6 shadow-lg">
          <div className="w-11 h-11 rounded-2xl bg-white text-black flex items-center justify-center mb-3"><Wallet size={20} /></div>
          <p className="text-xs font-bold uppercase tracking-widest opacity-70">Total Pending</p>
          <p className="font-display text-4xl font-black tracking-tighter" data-testid="kpi-pending">₹{totalPending.toLocaleString("en-IN")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
          <input
            data-testid="pay-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, booking #"
            className="w-full bg-white border border-black/10 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E63946]"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {["All", ...PAYMENT_STATUS_ORDER].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              data-testid={`pay-filter-${s}`}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap ${
                statusFilter === s ? "bg-black text-white" : "bg-white border border-black/10 text-black/70 hover:border-black"
              }`}
            >
              {s !== "All" && paymentStatusDot(s)} {s}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-black/[0.02] text-xs uppercase tracking-widest text-black/50">
            <tr>
              <th className="text-left px-5 py-4">Booking #</th>
              <th className="text-left px-5 py-4">Customer</th>
              <th className="text-left px-5 py-4">Total</th>
              <th className="text-left px-5 py-4">Advance</th>
              <th className="text-left px-5 py-4">Balance</th>
              <th className="text-left px-5 py-4">Payment Status</th>
              <th className="text-right px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-black/50">No bookings.</td></tr>}
            {filtered.map((b) => {
              const balance = Math.max(0, Number(b.total_amount || 0) - Number(b.advance_paid || 0));
              const ps = b.payment_status || "Advance Pending";
              return (
                <tr key={b.id} className="border-t border-black/5 hover:bg-black/[0.01]">
                  <td className="px-5 py-4 font-mono text-xs text-black/60">{b.booking_number}</td>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-black">{b.customer_name}</p>
                    <p className="text-xs text-black/50">{b.mobile}</p>
                  </td>
                  <td className="px-5 py-4 font-bold">₹{Number(b.total_amount).toLocaleString("en-IN")}</td>
                  <td className="px-5 py-4 text-green-700 font-semibold">₹{Number(b.advance_paid).toLocaleString("en-IN")}</td>
                  <td className="px-5 py-4 text-[#E63946] font-bold">₹{balance.toLocaleString("en-IN")}</td>
                  <td className="px-5 py-4">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${paymentStatusColor(ps)}`}>
                      {paymentStatusDot(ps)} {ps}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {ps === "Advance Pending" && (
                        <button onClick={() => sendAdvanceLink(b)} data-testid={`pay-adv-${b.id}`} title="Send Advance Link" className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-700"><Link2 size={14} /></button>
                      )}
                      {balance > 0 && Number(b.advance_paid) > 0 && (
                        <button onClick={() => openQR(b)} data-testid={`pay-qr-${b.id}`} title="View Balance QR" className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"><QrCode size={14} /></button>
                      )}
                      <button onClick={() => openHistory(b)} data-testid={`pay-hist-${b.id}`} title="History" className="p-1.5 rounded-lg hover:bg-black/5"><History size={14} /></button>
                      <button onClick={() => syncPayment(b)} data-testid={`pay-sync-${b.id}`} title="Sync" className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"><RefreshCw size={14} /></button>
                      <button onClick={() => navigate(`/invoice/${b.id}`)} data-testid={`pay-rcpt-${b.id}`} title="Receipt / Invoice" className="p-1.5 rounded-lg hover:bg-black/5"><FileText size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && <p className="text-center py-12 text-black/50">No bookings.</p>}
        {filtered.map((b) => {
          const balance = Math.max(0, Number(b.total_amount || 0) - Number(b.advance_paid || 0));
          const ps = b.payment_status || "Advance Pending";
          return (
            <div key={b.id} className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="min-w-0">
                  <p className="font-semibold text-black">{b.customer_name}</p>
                  <p className="text-xs text-black/50">{b.mobile} · {b.booking_number}</p>
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${paymentStatusColor(ps)}`}>
                  {paymentStatusDot(ps)} {ps}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 mb-3 p-2 rounded-xl bg-black/[0.02] text-center">
                <div><p className="text-[9px] uppercase text-black/40 font-bold">Total</p><p className="text-sm font-bold">₹{Number(b.total_amount).toLocaleString("en-IN")}</p></div>
                <div><p className="text-[9px] uppercase text-black/40 font-bold">Paid</p><p className="text-sm font-bold text-green-600">₹{Number(b.advance_paid).toLocaleString("en-IN")}</p></div>
                <div><p className="text-[9px] uppercase text-black/40 font-bold">Balance</p><p className="text-sm font-bold text-[#E63946]">₹{balance.toLocaleString("en-IN")}</p></div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {ps === "Advance Pending" && (
                  <button onClick={() => sendAdvanceLink(b)} data-testid={`m-pay-adv-${b.id}`} className="bg-yellow-50 text-yellow-700 rounded-full py-2 text-[10px] font-bold flex items-center justify-center gap-1"><Link2 size={12} /> Advance</button>
                )}
                {balance > 0 && Number(b.advance_paid) > 0 && (
                  <button onClick={() => openQR(b)} data-testid={`m-pay-qr-${b.id}`} className="bg-blue-50 text-blue-700 rounded-full py-2 text-[10px] font-bold flex items-center justify-center gap-1"><QrCode size={12} /> QR</button>
                )}
                <button onClick={() => openHistory(b)} data-testid={`m-pay-hist-${b.id}`} className="bg-black/5 rounded-full py-2 text-[10px] font-semibold flex items-center justify-center gap-1"><History size={12} /> History</button>
                <button onClick={() => syncPayment(b)} data-testid={`m-pay-sync-${b.id}`} className="bg-blue-50 text-blue-600 rounded-full py-2 text-[10px] font-bold flex items-center justify-center gap-1"><RefreshCw size={12} /> Sync</button>
                <button onClick={() => navigate(`/invoice/${b.id}`)} data-testid={`m-pay-rcpt-${b.id}`} className="bg-black/5 rounded-full py-2 text-[10px] font-semibold flex items-center justify-center gap-1"><FileText size={12} /> Receipt</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Record cash payment modal */}
      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-4">
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

      {/* QR modal */}
      {qrBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="qr-modal">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Balance Payment QR</p>
                <h3 className="font-display text-xl font-bold">{qrBooking.customer_name}</h3>
                <p className="text-xs text-black/50 font-mono">{qrBooking.booking_number}</p>
              </div>
              <button onClick={() => setQrBooking(null)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <div className="flex flex-col items-center py-4">
              {qrBooking.balance_qr_url ? (
                <img src={qrBooking.balance_qr_url} alt="QR" className="w-64 h-64 border border-black/10 rounded-2xl p-2 bg-white" data-testid="qr-image" />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-black/40 border border-dashed border-black/20 rounded-2xl">Generating…</div>
              )}
              <p className="mt-4 text-2xl font-black text-[#E63946]">₹{(Number(qrBooking.total_amount) - Number(qrBooking.advance_paid)).toLocaleString("en-IN")}</p>
              <p className="text-xs text-black/50">Scan with any UPI app · Razorpay</p>
              {qrBooking.balance_qr_payment_url && (
                <a href={qrBooking.balance_qr_payment_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mt-2 break-all text-center">{qrBooking.balance_qr_payment_url}</a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button data-testid="qr-share" onClick={() => shareQR(qrBooking)} className="bg-green-50 text-green-700 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2"><MessageCircle size={14} /> Share WA</button>
              <button data-testid="qr-download" onClick={() => downloadQR(qrBooking)} className="bg-black/5 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2"><Download size={14} /> Download</button>
              <button data-testid="qr-print" onClick={() => printQR(qrBooking)} className="bg-black/5 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2"><Printer size={14} /> Print</button>
              <button data-testid="qr-copy" onClick={() => copyLink(qrBooking.balance_qr_payment_url || "")} className="bg-black/5 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2"><Copy size={14} /> Copy Link</button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="history-modal">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Payment History</p>
                <h3 className="font-display text-xl font-bold">{historyBooking.customer_name}</h3>
                <p className="text-xs text-black/50 font-mono">{historyBooking.booking_number}</p>
              </div>
              <button onClick={() => setHistoryBooking(null)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="p-3 rounded-xl bg-black/[0.02]"><p className="text-[9px] uppercase font-bold text-black/40">Total</p><p className="font-bold">₹{Number(history.totals?.total_amount || 0).toLocaleString("en-IN")}</p></div>
              <div className="p-3 rounded-xl bg-green-50"><p className="text-[9px] uppercase font-bold text-green-700">Paid</p><p className="font-bold text-green-700">₹{Number(history.totals?.total_paid || 0).toLocaleString("en-IN")}</p></div>
              <div className="p-3 rounded-xl bg-red-50"><p className="text-[9px] uppercase font-bold text-[#E63946]">Balance</p><p className="font-bold text-[#E63946]">₹{Number(history.totals?.balance || 0).toLocaleString("en-IN")}</p></div>
            </div>
            {history.payments.length === 0 ? (
              <p className="text-center py-8 text-black/40 text-sm">No payments recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {history.payments.map((p) => (
                  <div key={p.id} className="border border-black/5 rounded-xl p-3 flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold">₹{Number(p.amount).toLocaleString("en-IN")} · <span className="text-xs text-black/60">{p.method}</span></p>
                      <p className="text-[10px] text-black/50">{new Date(p.created_at).toLocaleString()}</p>
                      {p.receipt_no && <p className="text-[10px] text-black/50 font-mono">Receipt: {p.receipt_no}</p>}
                      {p.note && <p className="text-[10px] text-black/60 mt-1">{p.note}</p>}
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-black/5">
                      {p.source || "manual"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
