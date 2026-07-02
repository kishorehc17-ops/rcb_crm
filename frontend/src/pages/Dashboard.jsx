import React, { useEffect, useState } from "react";
import api from "@/api";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, IndianRupee, Package, Timer, TrendingUp, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardCalendar from "@/components/DashboardCalendar";

const StatCard = ({ icon: Icon, label, value, tone = "black", delay = 0, testid, hint }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    data-testid={testid}
    className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm hover:shadow-lg hover:shadow-red-500/5 hover:-translate-y-1 transition-all duration-300"
  >
    <div className="flex items-center justify-between mb-4">
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${tone === "red" ? "bg-[#E63946] text-white" : "bg-black text-white"}`}>
        <Icon size={20} />
      </div>
      {hint && <span className="text-xs font-bold uppercase tracking-widest text-black/40">{hint}</span>}
    </div>
    <p className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1">{label}</p>
    <p className="font-display text-3xl sm:text-4xl font-black tracking-tighter text-black">{value}</p>
  </motion.div>
);

const inr = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [allBookings, setAllBookings] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data));
    api.get("/bookings").then((r) => {
      setAllBookings(r.data);
      setRecent(r.data.slice(0, 5));
    });
  }, []);

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Overview</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Dashboard</h1>
          <p className="text-black/60 mt-1">Everything you need at a glance.</p>
        </div>
        <button
          onClick={() => navigate("/bookings?new=1")}
          data-testid="dashboard-new-booking-btn"
          className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold transition-all active:scale-95 shadow-md shadow-red-500/20"
        >
          + New Booking
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard testid="stat-total" icon={Package} label="Total Bookings" value={stats?.total_bookings ?? "-"} delay={0.05} tone="red" />
        <StatCard testid="stat-today" icon={CalendarClock} label="Today" value={stats?.today_bookings ?? "-"} delay={0.1} />
        <StatCard testid="stat-upcoming" icon={Timer} label="Upcoming" value={stats?.upcoming_bookings ?? "-"} delay={0.15} />
        <StatCard testid="stat-completed" icon={CheckCircle2} label="Completed" value={stats?.completed_bookings ?? "-"} delay={0.2} />
        <StatCard testid="stat-revenue" icon={IndianRupee} label="Revenue" value={inr(stats?.revenue)} delay={0.25} tone="red" />
        <StatCard testid="stat-pending" icon={Wallet} label="Pending Payments" value={inr(stats?.pending_payments)} delay={0.3} />
        <StatCard testid="stat-expenses" icon={TrendingUp} label="Total Expenses" value={inr(stats?.total_expenses)} delay={0.35} />
        <StatCard testid="stat-net" icon={IndianRupee} label="Net Revenue" value={inr((stats?.revenue || 0) - (stats?.total_expenses || 0))} delay={0.4} tone="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl font-bold tracking-tight text-black">Recent Bookings</h2>
              <button onClick={() => navigate("/bookings")} data-testid="view-all-bookings" className="text-sm font-semibold text-[#E63946] hover:underline">View all →</button>
            </div>
            {recent.length === 0 ? (
              <div className="text-center py-12 text-black/50">
                <p className="mb-4">No bookings yet. Create your first booking to get started.</p>
                <button onClick={() => navigate("/bookings?new=1")} className="bg-black text-white rounded-full px-5 py-2 text-sm font-semibold">Add Booking</button>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-black/[0.02] transition-colors">
                    <div className="min-w-0">
                      <p className="font-semibold text-black truncate">{b.customer_name}</p>
                      <p className="text-xs text-black/50">{b.theme} · {b.event_date}</p>
                    </div>
                    <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
                      b.status === "Confirmed" ? "bg-green-100 text-green-700" :
                      b.status === "Completed" ? "bg-black text-white" :
                      b.status === "Cancelled" ? "bg-red-100 text-red-700" :
                      "bg-[#FFE5E8] text-[#E63946]"
                    }`}>{b.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-[#E63946] to-[#0A0A0A] text-white rounded-3xl p-6 shadow-lg shadow-red-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">Tip</p>
              <h3 className="font-display text-2xl font-bold tracking-tight">Turn leads into celebrations.</h3>
              <p className="text-sm opacity-80 mt-1">Move deals through your CRM pipeline in one click.</p>
            </div>
            <button onClick={() => navigate("/pipeline")} data-testid="dashboard-goto-pipeline" className="bg-white text-black rounded-full py-3 px-5 font-semibold text-sm hover:bg-white/90 transition self-start sm:self-auto whitespace-nowrap">
              Open Pipeline →
            </button>
          </div>
        </div>

        <div className="lg:col-span-1">
          <DashboardCalendar bookings={allBookings} />
        </div>
      </div>
    </div>
  );
}
