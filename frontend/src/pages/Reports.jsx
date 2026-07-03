import React, { useEffect, useState } from "react";
import api from "@/api";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, DollarSign, Receipt } from "lucide-react";

const RED = "#E63946";
const BLACK = "#0A0A0A";
const GREEN = "#16A34A";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";
const PALETTE = [RED, BLACK, GREEN, AMBER, BLUE, "#8B5CF6", "#EC4899", "#14B8A6"];

const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const shortMonth = (k) => {
  if (!k) return "";
  const [y, m] = k.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
};

export default function Reports() {
  const [data, setData] = useState(null);
  const [months, setMonths] = useState(6);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/overview?months=${months}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [months]);

  if (loading || !data) {
    return (
      <div className="space-y-4" data-testid="reports-loading">
        <div className="h-10 w-48 rounded-full bg-black/5 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-3xl bg-black/5 animate-pulse" />)}
        </div>
        <div className="h-80 rounded-3xl bg-black/5 animate-pulse" />
      </div>
    );
  }

  const monthly = (data.monthly || []).map((m) => ({ ...m, label: shortMonth(m.month) }));
  const profitTrend = data.totals.profit >= 0;

  return (
    <div className="space-y-6" data-testid="reports-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Analytics</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Reports</h1>
          <p className="text-sm text-black/50 mt-1">Sales · Expenses · Profit — last {months} months</p>
        </div>
        <div className="flex gap-2" data-testid="months-filter">
          {[3, 6, 12].map((n) => (
            <button
              key={n}
              onClick={() => setMonths(n)}
              data-testid={`months-${n}`}
              className={`px-4 py-2 rounded-full text-sm font-semibold ${
                months === n ? "bg-black text-white" : "bg-white border border-black/10 text-black/60 hover:border-black"
              }`}
            >
              {n}M
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="kpi-grid">
        <KpiCard
          icon={<DollarSign size={20} />}
          label="Total Sales"
          value={fmt(data.totals.sales)}
          color="from-green-500 to-emerald-600"
          testid="kpi-sales"
        />
        <KpiCard
          icon={<Receipt size={20} />}
          label="Total Expenses"
          value={fmt(data.totals.expenses)}
          color="from-red-500 to-rose-600"
          testid="kpi-expenses"
        />
        <KpiCard
          icon={profitTrend ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          label="Net Profit"
          value={fmt(data.totals.profit)}
          color={profitTrend ? "from-blue-500 to-indigo-600" : "from-orange-500 to-red-600"}
          testid="kpi-profit"
        />
      </div>

      {/* Monthly Sales vs Expenses bar chart */}
      <ChartCard title="Sales vs Expenses" testid="chart-sales-expenses">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
            <XAxis dataKey="label" stroke="#00000060" fontSize={12} />
            <YAxis stroke="#00000060" fontSize={12} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 12, border: "1px solid #00000010" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="sales" fill={GREEN} radius={[6, 6, 0, 0]} name="Sales" />
            <Bar dataKey="expenses" fill={RED} radius={[6, 6, 0, 0]} name="Expenses" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Profit trend line */}
      <ChartCard title="Profit Trend" testid="chart-profit">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
            <XAxis dataKey="label" stroke="#00000060" fontSize={12} />
            <YAxis stroke="#00000060" fontSize={12} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 12, border: "1px solid #00000010" }} />
            <Line
              type="monotone"
              dataKey="profit"
              stroke={BLACK}
              strokeWidth={3}
              dot={{ r: 5, fill: RED, strokeWidth: 0 }}
              activeDot={{ r: 8 }}
              name="Profit"
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Two column: expense categories + booking status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Expense Categories" testid="chart-exp-cat">
          {data.expense_categories.length === 0 ? (
            <EmptyState label="No expenses yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.expense_categories}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={11}
                >
                  {data.expense_categories.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Booking Status" testid="chart-booking-status">
          {data.booking_status_counts.length === 0 ? (
            <EmptyState label="No bookings" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.booking_status_counts}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  paddingAngle={2}
                  label={({ name, value }) => `${name} · ${value}`}
                  labelLine={false}
                  fontSize={11}
                >
                  {data.booking_status_counts.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Top themes / packages / payment methods */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="Top Themes" testid="chart-themes">
          <RankedList items={data.top_themes} unit="bookings" />
        </ChartCard>
        <ChartCard title="Package Mix" testid="chart-packages">
          <RankedList items={data.top_packages.map((p) => ({ name: p.name, count: p.count }))} unit="bookings" />
        </ChartCard>
        <ChartCard title="Payment Methods" testid="chart-methods">
          <RankedList items={data.payment_methods.map((m) => ({ name: m.name, count: m.value }))} unit="₹" money />
        </ChartCard>
      </div>
    </div>
  );
}

const KpiCard = ({ icon, label, value, color, testid }) => (
  <div className={`bg-gradient-to-br ${color} text-white rounded-3xl p-6 shadow-lg`} data-testid={testid}>
    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-4">{icon}</div>
    <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">{label}</p>
    <p className="font-display text-3xl sm:text-4xl font-black tracking-tighter">{value}</p>
  </div>
);

const ChartCard = ({ title, children, testid }) => (
  <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm" data-testid={testid}>
    <h3 className="font-display font-bold text-lg text-black mb-4">{title}</h3>
    {children}
  </div>
);

const EmptyState = ({ label }) => (
  <div className="h-56 flex items-center justify-center text-sm text-black/40">{label}</div>
);

const RankedList = ({ items, unit = "", money = false }) => {
  if (!items || items.length === 0) return <EmptyState label="No data yet" />;
  const max = Math.max(...items.map((x) => x.count || x.value || 0), 1);
  return (
    <div className="space-y-2.5">
      {items.slice(0, 8).map((it, i) => {
        const val = it.count ?? it.value ?? 0;
        const pct = (val / max) * 100;
        return (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-black truncate max-w-[70%]">{it.name}</p>
              <p className="text-xs font-bold text-black/70">
                {money ? `₹${Number(val).toLocaleString("en-IN")}` : `${val} ${unit}`}
              </p>
            </div>
            <div className="h-2 rounded-full bg-black/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#E63946] to-[#8B0000]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
