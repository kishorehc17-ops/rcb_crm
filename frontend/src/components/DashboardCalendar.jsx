import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export default function DashboardCalendar({ bookings = [], selected, onSelect, month, year, onMonthChange }) {
  const first = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const bookingsOn = (d) => bookings.filter((b) => b.event_date === dateStr(d));

  const prev = () => {
    if (month === 0) onMonthChange(11, year - 1);
    else onMonthChange(month - 1, year);
  };
  const next = () => {
    if (month === 11) onMonthChange(0, year + 1);
    else onMonthChange(month + 1, year);
  };

  const monthName = new Date(year, month).toLocaleString("en-US", { month: "long" });
  const daysHeader = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="bg-white border border-black/5 rounded-3xl p-4 sm:p-6 shadow-sm" data-testid="dashboard-calendar">
      <div className="flex items-center justify-between mb-6">
        <button data-testid="cal-prev" onClick={prev} className="p-2 rounded-full hover:bg-black/5"><ChevronLeft /></button>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Calendar</p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{monthName} {year}</h2>
        </div>
        <button data-testid="cal-next" onClick={next} className="p-2 rounded-full hover:bg-black/5"><ChevronRight /></button>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
        {daysHeader.map((d) => (
          <div key={d} className="text-center text-[10px] sm:text-xs font-bold uppercase tracking-widest text-black/50 py-2">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const bs = bookingsOn(d);
          const booked = bs.length > 0;
          const ds = dateStr(d);
          const isSel = selected === ds;
          return (
            <button
              key={i}
              data-testid={`cal-day-${d}`}
              onClick={() => onSelect(ds)}
              className={`aspect-square rounded-xl border transition-all p-1 sm:p-2 flex flex-col items-start justify-between text-left ${
                booked
                  ? "bg-[#FFE5E8] border-[#E63946]/30 hover:border-[#E63946] text-[#E63946]"
                  : "bg-[#EBFBEE] border-green-200 hover:border-green-500 text-green-700"
              } ${isSel ? "ring-2 ring-black" : ""}`}
            >
              <span className="text-sm font-bold">{d}</span>
              {booked && <span className="text-[9px] sm:text-[10px] font-semibold">{bs.length} event{bs.length > 1 ? "s" : ""}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 mt-4 text-xs">
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-[#EBFBEE] border border-green-200" /> Available</div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-[#FFE5E8] border border-[#E63946]/30" /> Booked</div>
      </div>
    </div>
  );
}
