import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api";
import { ArrowLeft, Printer } from "lucide-react";

export default function Invoice() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [b, setB] = useState(null);

  useEffect(() => {
    api.get(`/bookings/${id}`).then((r) => setB(r.data));
  }, [id]);

  if (!b) return <div className="p-8">Loading...</div>;

  const balance = Number(b.total_amount) - Number(b.advance_paid);
  const qrData = encodeURIComponent(`RCB Events Invoice: ${b.booking_number} | ${b.customer_name} | ₹${b.total_amount}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${qrData}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center print:hidden">
        <button data-testid="back-btn" onClick={() => navigate(-1)} className="flex items-center gap-2 text-black/60 hover:text-black"><ArrowLeft size={18} /> Back</button>
        <button data-testid="print-btn" onClick={() => window.print()} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Printer size={16} /> Print / Save PDF</button>
      </div>

      <div className="bg-white border border-black/10 rounded-3xl p-8 sm:p-12 max-w-4xl mx-auto shadow-lg print:shadow-none print:border-0 print:rounded-none" data-testid="invoice-content">
        {/* Header */}
        <div className="flex justify-between items-start pb-6 border-b-4 border-[#E63946]">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 rounded-2xl bg-[#E63946] flex items-center justify-center text-white font-black text-2xl">R</div>
              <div>
                <h1 className="font-display text-3xl font-black tracking-tighter text-black">RCB EVENTS</h1>
                <p className="text-xs uppercase tracking-widest text-[#E63946] font-bold">Birthday & Event Decorators</p>
              </div>
            </div>
            <p className="text-sm text-black/60">Balloon Decorations · Themed Backdrops · Welcome Boards</p>
            <p className="text-sm text-black/60">contact@rcbevents.com · +91 98765 43210</p>
          </div>
          <div className="text-right">
            <p className="font-display text-4xl font-black tracking-tighter text-black">INVOICE</p>
            <p className="text-sm text-black/60 mt-1">#{b.booking_number}</p>
            <p className="text-xs text-black/50">{new Date(b.created_at).toLocaleDateString("en-IN")}</p>
          </div>
        </div>

        {/* Bill To */}
        <div className="grid grid-cols-2 gap-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-black/50 mb-2">Bill To</p>
            <p className="font-bold text-black text-lg">{b.customer_name}</p>
            <p className="text-sm text-black/70">{b.mobile}</p>
            <p className="text-sm text-black/60">{b.location}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-black/50 mb-2">Event Details</p>
            <p className="font-bold text-black">{b.theme}</p>
            <p className="text-sm text-black/70">Date: {b.event_date} at {b.event_time}</p>
            <p className="text-sm text-black/60">Status: <span className="font-semibold">{b.status}</span></p>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full mt-4">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-widest">Description</th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-widest">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/10">
              <td className="px-4 py-4">
                <p className="font-semibold text-black">{b.package_name || "Event Package"}</p>
                <p className="text-sm text-black/60">{b.theme} theme decoration</p>
                {b.special_requirements && <p className="text-xs text-black/50 mt-1">Note: {b.special_requirements}</p>}
              </td>
              <td className="px-4 py-4 text-right font-bold text-black">₹{Number(b.total_amount).toLocaleString("en-IN")}</td>
            </tr>
          </tbody>
        </table>

        {/* Summary + QR */}
        <div className="grid grid-cols-2 gap-6 mt-6">
          <div className="flex flex-col items-start">
            <p className="text-xs font-bold uppercase tracking-widest text-black/50 mb-2">Scan for details</p>
            <img src={qrUrl} alt="QR Code" className="rounded-xl border border-black/10" />
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-black/5">
              <span className="text-black/60">Subtotal</span>
              <span className="font-semibold">₹{Number(b.total_amount).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-black/5">
              <span className="text-black/60">Advance Paid</span>
              <span className="font-semibold text-green-700">- ₹{Number(b.advance_paid).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between py-3 mt-2 bg-[#E63946] text-white rounded-xl px-4">
              <span className="font-bold uppercase tracking-widest text-sm">Balance Due</span>
              <span className="font-display text-2xl font-black">₹{balance.toLocaleString("en-IN")}</span>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-black/10 text-center">
          <p className="text-xs text-black/50">Thank you for choosing RCB Events. We look forward to making your celebration unforgettable.</p>
          <p className="text-[10px] text-black/40 mt-2 uppercase tracking-widest">This is a computer generated invoice</p>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          nav, .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
