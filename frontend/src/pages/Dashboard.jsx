import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, IndianRupee, Package, Timer, TrendingUp, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardCalendar from "@/components/DashboardCalendar";

const CompactStat = ({ icon: Icon, label, value, tone = "black", testid, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.25 }}
    data-testid={testid}
    className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
  >
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone === "red" ? "bg-[#E63946] text-white" : "bg-black text-white"}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-black/50 truncate">{label}</p>
        <p className="font-display text-lg sm:text-xl font-black tracking-tight text-black truncate">{value}</p>
      </div>
    </div>
  </motion.div>
);

const inr = (n) => `₹${(n || 0).toLocaleString("en-IN")}`;
const statusBadge = (s) => ({
  "Confirmed": "bg-green-100 text-green-700",
  "Completed": "bg-black text-white",
  "Cancelled": "bg-red-100 text-red-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "Pending": "bg-[#FFE5E8] text-[#E63946]",
  "Inquiry": "bg-black/10 text-black",
}[s] || "bg-black/10 text-black");

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data));
    api.get("/bookings").then((r) => setBookings(r.data));
  }, []);

  const bookingsOnSelected = useMemo(
    () => (selectedDate ? bookings.filter((b) => b.event_date === selectedDate) : []),
    [selectedDate, bookings]
  );

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return bookings
      .filter((b) => b.event_date >= today && !["Cancelled", "Completed"].includes(b.status))
      .sort((a, b) => a.event_date.localeCompare(b.event_date))
      .slice(0, 8);
  }, [bookings]);

  return (
    <div className="space-y-6" data-testid="dashboard-page">
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

      {/* Compact stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <CompactStat testid="stat-total" icon={Package} label="Total" value={stats?.total_bookings ?? "-"} tone="red" delay={0.02} />
        <CompactStat testid="stat-today" icon={CalendarClock} label="Today" value={stats?.today_bookings ?? "-"} delay={0.04} />
        <CompactStat testid="stat-upcoming" icon={Timer} label="Upcoming" value={stats?.upcoming_bookings ?? "-"} delay={0.06} />
        <CompactStat testid="stat-completed" icon={CheckCircle2} label="Completed" value={stats?.completed_bookings ?? "-"} delay={0.08} />
        <CompactStat testid="stat-revenue" icon={IndianRupee} label="Revenue" value={inr(stats?.revenue)} tone="red" delay={0.1} />
        <CompactStat testid="stat-pending" icon={Wallet} label="Pending" value={inr(stats?.pending_payments)} delay={0.12} />
        <CompactStat testid="stat-expenses" icon={TrendingUp} label="Expenses" value={inr(stats?.total_expenses)} delay={0.14} />
        <CompactStat testid="stat-net" icon={IndianRupee} label="Net" value={inr((stats?.revenue || 0) - (stats?.total_expenses || 0))} tone="red" delay={0.16} />
      </div>

      {/* Calendar (full width) */}
      <DashboardCalendar
        bookings={bookings}
        selected={selectedDate}
        onSelect={setSelectedDate}
        month={month}
        year={year}
        onMonthChange={(m, y) => { setMonth(m); setYear(y); }}
      />

      {/* Selected date bookings */}
      {selectedDate && (
        <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm" data-testid="selected-date-panel">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Selected Date</p>
              <h2 className="font-display text-2xl font-bold tracking-tight">{selectedDate}</h2>
            </div>
            <button onClick={() => setSelectedDate(null)} className="text-sm text-black/50 hover:text-black">Clear</button>
          </div>
          {bookingsOnSelected.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-green-700 font-semibold mb-3">✓ This date is available.</p>
              <button
                onClick={() => navigate(`/bookings?new=1`)}
                data-testid="book-selected-date"
                className="bg-black text-white rounded-full px-5 py-2 text-sm font-semibold hover:bg-[#1F1F1F]"
              >
                Create a booking for this date
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {bookingsOnSelected.map((b) => (
                <div
                  key={b.id}
                  data-testid={`selected-booking-${b.id}`}
                  onClick={() => navigate(`/bookings`)}
                  className="flex items-center justify-between p-4 rounded-2xl border border-black/5 hover:border-[#E63946]/30 hover:bg-black/[0.02] cursor-pointer transition-all"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-black">{b.customer_name} <span className="text-xs font-mono text-black/40 ml-2">{b.booking_number}</span></p>
                    <p className="text-sm text-black/60">{b.theme} · {b.event_time} · {b.location}</p>
                    <p className="text-xs text-black/50 mt-1">{b.package_name} · ₹{Number(b.total_amount).toLocaleString("en-IN")}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${statusBadge(b.status)}`}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upcoming bookings */}
      <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Coming up</p>
            <h2 className="font-display text-2xl font-bold tracking-tight">Upcoming Bookings</h2>
          </div>
          <button onClick={() => navigate("/bookings")} data-testid="view-all-bookings" className="text-sm font-semibold text-[#E63946] hover:underline">View all →</button>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-center py-12 text-black/50">
            <p className="mb-4">No upcoming bookings.</p>
            <button onClick={() => navigate("/bookings?new=1")} className="bg-black text-white rounded-full px-5 py-2 text-sm font-semibold">Add Booking</button>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((b) => {
              const daysAway = Math.ceil((new Date(b.event_date) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div
                  key={b.id}
                  data-testid={`upcoming-${b.id}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-black/[0.02] transition-colors"
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#FFE5E8] text-[#E63946] flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold uppercase">{new Date(b.event_date).toLocaleString("en-US", { month: "short" })}</span>
                    <span className="text-lg font-black leading-none">{new Date(b.event_date).getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-black truncate">{b.customer_name}</p>
                    <p className="text-xs text-black/50 truncate">{b.theme} · {b.event_time} · {b.location || "TBD"}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-black/50">In {daysAway} day{daysAway !== 1 ? "s" : ""}</p>
                    <p className="text-sm font-bold text-black">₹{Number(b.total_amount).toLocaleString("en-IN")}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${statusBadge(b.status)}`}>{b.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
