import React, { useEffect, useState } from "react";
import api from "@/api";
import { ChevronLeft, ChevronRight } from "lucide-react";

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export default function CalendarPage() {
  const [bookings, setBookings] = useState([]);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/bookings").then((r) => setBookings(r.data));
  }, []);

  const first = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const bookingsOn = (d) => bookings.filter((b) => b.event_date === dateStr(d));

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1);
  };
  const next = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1);
  };

  const monthName = new Date(year, month).toLocaleString("en-US", { month: "long" });
  const daysHeader = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6" data-testid="calendar-page">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Calendar</p>
        <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Event Schedule</h1>
      </div>

      <div className="bg-white border border-black/5 rounded-3xl p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <button onClick={prev} data-testid="cal-prev" className="p-2 rounded-full hover:bg-black/5"><ChevronLeft /></button>
          <h2 className="font-display text-2xl font-bold tracking-tight">{monthName} {year}</h2>
          <button onClick={next} data-testid="cal-next" className="p-2 rounded-full hover:bg-black/5"><ChevronRight /></button>
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
            return (
              <button
                key={i}
                data-testid={`cal-day-${d}`}
                onClick={() => setSelected(d)}
                className={`aspect-square rounded-xl border transition-all p-1 sm:p-2 flex flex-col items-start justify-between text-left ${
                  booked
                    ? "bg-[#FFE5E8] border-[#E63946]/30 hover:border-[#E63946] text-[#E63946]"
                    : "bg-[#EBFBEE] border-green-200 hover:border-green-500 text-green-700"
                } ${selected === d ? "ring-2 ring-black" : ""}`}
              >
                <span className="text-sm font-bold">{d}</span>
                {booked && (
                  <span className="text-[9px] sm:text-[10px] font-semibold">
                    {bs.length} event{bs.length > 1 ? "s" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 mt-6 text-xs">
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-[#EBFBEE] border border-green-200" /> Available</div>
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-[#FFE5E8] border border-[#E63946]/30" /> Booked</div>
        </div>
      </div>

      {selected && (
        <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm" data-testid="selected-day-panel">
          <h3 className="font-display text-xl font-bold mb-4">Bookings on {dateStr(selected)}</h3>
          {bookingsOn(selected).length === 0 ? (
            <p className="text-black/50">No bookings — this date is available.</p>
          ) : (
            <div className="space-y-2">
              {bookingsOn(selected).map((b) => (
                <div key={b.id} className="p-3 bg-black/[0.02] rounded-xl flex justify-between">
                  <div>
                    <p className="font-semibold">{b.customer_name}</p>
                    <p className="text-xs text-black/50">{b.theme} · {b.event_time}</p>
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-[#FFE5E8] text-[#E63946] self-center">{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
