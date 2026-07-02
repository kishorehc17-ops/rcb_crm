import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export default function DashboardCalendar({ bookings = [] }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selected, setSelected] = useState(null);

  const first = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const bookingsOn = (d) => bookings.filter((b) => b.event_date === dateStr(d));

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const monthName = new Date(year, month).toLocaleString("en-US", { month: "long" });
  const daysHeader = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="bg-white border border-black/5 rounded-3xl p-4 sm:p-6 shadow-sm" data-testid="dashboard-calendar">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946]">Calendar</p>
          <h2 className="font-display text-xl font-bold tracking-tight">{monthName} {year}</h2>
        </div>
        <div className="flex gap-1">
          <button data-testid="cal-prev" onClick={prev} className="p-2 rounded-full hover:bg-black/5"><ChevronLeft size={18} /></button>
          <button data-testid="cal-next" onClick={next} className="p-2 rounded-full hover:bg-black/5"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {daysHeader.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold uppercase tracking-widest text-black/40 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const bs = bookingsOn(d);
          const booked = bs.length > 0;
          const isSelected = selected === d;
          return (
            <button
              key={i}
              data-testid={`cal-day-${d}`}
              onClick={() => setSelected(d)}
              className={`aspect-square rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center ${
                booked
                  ? "bg-[#FFE5E8] border-[#E63946]/30 text-[#E63946] hover:border-[#E63946]"
                  : "bg-[#EBFBEE] border-green-200 text-green-700 hover:border-green-500"
              } ${isSelected ? "ring-2 ring-black" : ""}`}
            >
              <span>{d}</span>
              {booked && <span className="text-[8px] font-semibold">{bs.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 mt-3 text-[10px] text-black/50">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-[#EBFBEE] border border-green-200" /> Available</div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-[#FFE5E8] border border-[#E63946]/30" /> Booked</div>
      </div>

      {selected && bookingsOn(selected).length > 0 && (
        <div className="mt-4 pt-4 border-t border-black/5" data-testid="cal-selected-panel">
          <p className="text-xs font-bold uppercase tracking-widest text-black/50 mb-2">{dateStr(selected)}</p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {bookingsOn(selected).map((b) => (
              <div key={b.id} className="flex justify-between items-center p-2 bg-black/[0.02] rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-black truncate">{b.customer_name}</p>
                  <p className="text-[10px] text-black/50">{b.theme} · {b.event_time}</p>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#FFE5E8] text-[#E63946]">{b.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {selected && bookingsOn(selected).length === 0 && (
        <p className="mt-4 pt-4 border-t border-black/5 text-xs text-green-700 font-semibold">{dateStr(selected)} · Available</p>
      )}
    </div>
  );
}
