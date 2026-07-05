import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Plus, Search, Filter, ArrowUpDown, LayoutGrid, List as ListIcon,
  Package as PkgIcon, CheckCircle2, ShoppingBag, IndianRupee,
  Image as ImageIcon, Video, FileText, Check, MoreHorizontal,
  MessageCircle, Eye, Edit3, Trash2, X, ChevronLeft, ChevronRight,
  Copy, QrCode, Receipt, Archive, TrendingUp, Send, Sparkles, Phone,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BADGE_STYLES = {
  "POPULAR": "bg-gradient-to-r from-orange-500 to-red-500 text-white",
  "BEST SELLER": "bg-gradient-to-r from-yellow-400 to-orange-500 text-white",
  "PREMIUM": "bg-gradient-to-r from-purple-500 to-indigo-600 text-white",
  "NEW": "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
  "LIMITED": "bg-gradient-to-r from-red-500 to-pink-500 text-white",
  "MOST BOOKED": "bg-gradient-to-r from-[#E63946] to-[#8B0000] text-white",
  "BUDGET": "bg-gradient-to-r from-pink-400 to-pink-500 text-white",
  "BEST VALUE": "bg-gradient-to-r from-teal-400 to-cyan-500 text-white",
  "CORPORATE": "bg-gradient-to-r from-slate-700 to-slate-900 text-white",
  "CUSTOM": "bg-gradient-to-r from-violet-500 to-purple-600 text-white",
};

const statusChip = (s) => ({
  Active: "bg-green-50 text-green-700 border-green-200",
  Inactive: "bg-slate-50 text-slate-500 border-slate-200",
  Draft: "bg-amber-50 text-amber-700 border-amber-200",
}[s] || "bg-slate-50 text-slate-600 border-slate-200");

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const compact = (n) => {
  if (!n) return "0";
  const num = Number(n);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}k`;
  return `₹${num.toLocaleString("en-IN")}`;
};

const derivedStatus = (p) => p.status || (p.active === false ? "Inactive" : "Active");

export default function Packages() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [analytics, setAnalytics] = useState({ per_package: {}, totals: { bookings: 0, revenue: 0 } });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty());
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("All"); // All | Active | Inactive | Draft
  const [sort, setSort] = useState("bookings"); // bookings | price | name | newest
  const [view, setView] = useState("grid"); // grid | list
  const [drawer, setDrawer] = useState(null); // package
  const [drawerImg, setDrawerImg] = useState(0);
  const [wa, setWa] = useState(null);       // {package} for WhatsApp send picker

  const load = async () => {
    const [rp, ra] = await Promise.all([
      api.get("/packages"),
      api.get("/packages/analytics").catch(() => ({ data: { per_package: {}, totals: { bookings: 0, revenue: 0 } } })),
    ]);
    setRows(rp.data);
    setAnalytics(ra.data);
  };
  useEffect(() => { load(); }, []);

  const totalActive = useMemo(() => rows.filter((r) => derivedStatus(r) === "Active").length, [rows]);
  const totalInactive = useMemo(() => rows.filter((r) => derivedStatus(r) === "Inactive").length, [rows]);
  const totalDraft = useMemo(() => rows.filter((r) => derivedStatus(r) === "Draft").length, [rows]);

  const filtered = useMemo(() => {
    let arr = rows;
    if (tab !== "All") arr = arr.filter((p) => derivedStatus(p) === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((p) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
    }
    if (sort === "bookings") arr = [...arr].sort((a, b) => (analytics.per_package[b.id]?.bookings || 0) - (analytics.per_package[a.id]?.bookings || 0));
    else if (sort === "price") arr = [...arr].sort((a, b) => b.price - a.price);
    else if (sort === "name") arr = [...arr].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else if (sort === "newest") arr = [...arr].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return arr;
  }, [rows, tab, search, sort, analytics]);

  // Auto-derive badges from analytics (if not explicitly set)
  const packageBadge = (p) => {
    if (p.badge) return p.badge;
    const stats = analytics.per_package[p.id];
    if (!stats) return null;
    const maxBookings = Math.max(...Object.values(analytics.per_package).map((v) => v.bookings || 0), 0);
    if (maxBookings > 0 && stats.bookings === maxBookings) return "MOST BOOKED";
    if (p.price >= 20000) return "PREMIUM";
    if (p.price < 6000) return "BUDGET";
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      price: Number(form.price),
      offer_price: form.offer_price ? Number(form.offer_price) : null,
      max_addons: Number(form.max_addons || 0),
      decorations: (form.decorations_text || "").split("\n").map((x) => x.trim()).filter(Boolean),
      addons: (form.addons_text || "").split(",").map((x) => x.trim()).filter(Boolean),
      photos: (form.photos_text || "").split("\n").map((x) => x.trim()).filter(Boolean),
      videos: (form.videos_text || "").split("\n").map((x) => x.trim()).filter(Boolean),
      tags: (form.tags_text || "").split(",").map((x) => x.trim()).filter(Boolean),
      status: form.status || (form.active ? "Active" : "Inactive"),
    };
    if (editingId) await api.put(`/packages/${editingId}`, payload);
    else await api.post("/packages", payload);
    toast.success(editingId ? "Package updated" : "Package created");
    setShowForm(false); setEditingId(null); setForm(empty());
    load();
  };

  const edit = (p) => {
    setForm({
      ...p,
      offer_price: p.offer_price ?? "",
      decorations_text: (p.decorations || []).join("\n"),
      addons_text: (p.addons || []).join(", "),
      photos_text: (p.photos || []).join("\n"),
      videos_text: (p.videos || []).join("\n"),
      tags_text: (p.tags || []).join(", "),
      status: derivedStatus(p),
    });
    setEditingId(p.id); setShowForm(true);
  };

  const del = async (id) => {
    if (!window.confirm("Delete this package?")) return;
    await api.delete(`/packages/${id}`);
    toast.success("Deleted");
    load();
  };

  const duplicatePkg = async (p) => {
    await api.post(`/packages/${p.id}/duplicate`);
    toast.success(`Duplicated "${p.name}"`);
    load();
  };

  const archivePkg = async (p) => {
    await api.put(`/packages/${p.id}`, { ...p, active: false, status: "Inactive" });
    toast.success(`Archived "${p.name}"`);
    load();
  };

  const openWaSend = (p) => {
    setWa({ pkg: p, phone: "" });
  };

  const sendPkgToNumber = async (e) => {
    e.preventDefault();
    if (!wa?.phone?.trim()) return;
    try {
      await api.post("/whatsapp/send-package", { wa_id: wa.phone.trim(), package_id: wa.pkg.id });
      toast.success(`Sent "${wa.pkg.name}" to +${wa.phone}`);
      setWa(null);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Send failed");
    }
  };

  const bookFromPackage = (p) => {
    nav(`/bookings?new=1&prefill_mobile=&prefill_name=`);
    // The bookings modal will open; user picks package inside it. Alternatively pre-pick via URL later.
  };

  const cover = (p) => p.cover_image || (p.photos && p.photos[0]) || null;
  const kpi = (p) => analytics.per_package[p.id] || { bookings: 0, revenue: 0, sent_via_whatsapp: 0, conversion_rate: 0 };

  return (
    <div className="space-y-6 pb-24" data-testid="packages-page">
      {/* HEADER */}
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Package Management</h1>
          <p className="text-sm text-black/50 mt-1 max-w-xl">Manage all decoration packages, galleries, pricing and WhatsApp sharing from one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative hidden md:block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
            <input
              data-testid="pkg-search"
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages..."
              className="pl-9 pr-4 py-2 text-sm rounded-xl border border-black/10 bg-white focus:border-black outline-none w-64 transition-colors"
            />
          </div>
          <button className="hidden md:flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-black/10 bg-white text-sm text-black/70 hover:border-black transition-colors">
            <Filter size={14} /> Filter
          </button>
          <div className="hidden md:flex">
            <select data-testid="pkg-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-black/10 bg-white text-sm text-black/70 hover:border-black transition-colors cursor-pointer">
              <option value="bookings">Sort: Bookings</option>
              <option value="price">Sort: Price</option>
              <option value="name">Sort: Name</option>
              <option value="newest">Sort: Newest</option>
            </select>
          </div>
          <div className="hidden md:flex border border-black/10 bg-white rounded-xl overflow-hidden">
            <button onClick={() => setView("grid")} data-testid="view-grid" className={`p-2 ${view === "grid" ? "bg-black/[0.04] text-[#E63946]" : "text-black/50 hover:bg-black/[0.02]"}`}><LayoutGrid size={16} /></button>
            <button onClick={() => setView("list")} data-testid="view-list" className={`p-2 ${view === "list" ? "bg-black/[0.04] text-[#E63946]" : "text-black/50 hover:bg-black/[0.02]"}`}><ListIcon size={16} /></button>
          </div>
          <button
            data-testid="new-package-btn" onClick={() => { setEditingId(null); setForm(empty()); setShowForm(true); }}
            className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2 shadow-md shadow-red-500/20 transition-all"
          >
            <Plus size={16} /> New Package
          </button>
        </div>
      </div>

      {/* Mobile search */}
      <div className="md:hidden">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
          <input
            data-testid="pkg-search-mobile" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packages..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-black/10 bg-white focus:border-black outline-none"
          />
        </div>
      </div>

      {/* STATISTICS BAR */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="stats-bar">
        <StatCard icon={<PkgIcon size={18} />} iconBg="bg-red-50 text-[#E63946]" label="Total Packages" value={rows.length} trend="+12% from last month" trendColor="text-green-600" spark="#E63946" testid="stat-total" />
        <StatCard icon={<CheckCircle2 size={18} />} iconBg="bg-green-50 text-green-600" label="Active Packages" value={totalActive} trend="+8% from last month" trendColor="text-green-600" spark="#16A34A" testid="stat-active" />
        <StatCard icon={<ShoppingBag size={18} />} iconBg="bg-purple-50 text-purple-600" label="Total Bookings Generated" value={analytics.totals.bookings} trend="+24% from last month" trendColor="text-green-600" spark="#8B5CF6" testid="stat-bookings" />
        <StatCard icon={<IndianRupee size={18} />} iconBg="bg-amber-50 text-amber-600" label="Revenue Generated" value={compact(analytics.totals.revenue)} trend="+28% from last month" trendColor="text-green-600" spark="#F59E0B" testid="stat-revenue" />
      </div>

      {/* TABS */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <TabBtn active={tab === "All"} onClick={() => setTab("All")} label="All Packages" count={rows.length} testid="tab-all" />
        <TabBtn active={tab === "Active"} onClick={() => setTab("Active")} label="Active" count={totalActive} testid="tab-active" />
        <TabBtn active={tab === "Inactive"} onClick={() => setTab("Inactive")} label="Inactive" count={totalInactive} testid="tab-inactive" />
        <TabBtn active={tab === "Draft"} onClick={() => setTab("Draft")} label="Draft" count={totalDraft} testid="tab-draft" />
      </div>

      {/* PACKAGE GRID */}
      {filtered.length === 0 ? (
        <div className="p-16 text-center text-black/40 bg-white border border-black/5 rounded-3xl">No packages match your filters.</div>
      ) : (
        <div className={view === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" : "space-y-3"}>
          {filtered.map((p) => (
            <PkgCard
              key={p.id} p={p} kpi={kpi(p)} status={derivedStatus(p)} badge={packageBadge(p)}
              onClick={() => { setDrawer(p); setDrawerImg(0); }}
              onSend={() => openWaSend(p)}
              onEdit={() => edit(p)} onDel={() => del(p.id)}
              onBook={() => bookFromPackage(p)} onDup={() => duplicatePkg(p)}
              onArchive={() => archivePkg(p)} view={view} cover={cover(p)}
            />
          ))}
        </div>
      )}

      {/* SIDE DRAWER */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(null)} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
            <motion.aside
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 260 }}
              className="fixed top-0 right-0 z-50 h-full w-full sm:w-[520px] md:w-[560px] bg-white shadow-2xl overflow-y-auto"
              data-testid="pkg-drawer"
            >
              <PkgDrawer
                p={drawer} kpi={kpi(drawer)} status={derivedStatus(drawer)} badge={packageBadge(drawer)}
                imgIdx={drawerImg} setImgIdx={setDrawerImg}
                onClose={() => setDrawer(null)}
                onSend={() => openWaSend(drawer)} onEdit={() => { edit(drawer); setDrawer(null); }}
                onBook={() => bookFromPackage(drawer)} onDup={() => duplicatePkg(drawer)}
                onArchive={() => archivePkg(drawer)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* FORM MODAL */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-2xl rounded-3xl p-6 pb-24 sm:pb-6 max-h-[92vh] overflow-y-auto space-y-3">
            <div className="flex justify-between items-start">
              <h2 className="font-display text-2xl font-bold">{editingId ? "Edit Package" : "New Package"}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name *"><input required data-testid="f-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
              <Field label="Price ₹ *"><input required type="number" data-testid="f-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={inputCls} /></Field>
              <Field label="Offer Price ₹"><input type="number" data-testid="f-offer" value={form.offer_price} onChange={(e) => setForm({ ...form, offer_price: e.target.value })} className={inputCls} placeholder="Optional discounted price" /></Field>
              <Field label="Max Add-ons"><input type="number" data-testid="f-max-addons" value={form.max_addons} onChange={(e) => setForm({ ...form, max_addons: e.target.value })} className={inputCls} /></Field>
              <Field label="Status">
                <select data-testid="f-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value, active: e.target.value === "Active" })} className={inputCls}>
                  <option>Active</option><option>Inactive</option><option>Draft</option>
                </select>
              </Field>
              <Field label="Badge">
                <select data-testid="f-badge" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} className={inputCls}>
                  <option value="">Auto-detect</option>
                  {Object.keys(BADGE_STYLES).map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Short Description"><textarea data-testid="f-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Elegant 2-line description shown on the card"/></Field>
            <Field label="Cover Image URL"><input data-testid="f-cover" value={form.cover_image} onChange={(e) => setForm({ ...form, cover_image: e.target.value })} className={inputCls} placeholder="https://..." /></Field>
            <Field label="Photo URLs (one per line)"><textarea data-testid="f-photos" rows={3} value={form.photos_text} onChange={(e) => setForm({ ...form, photos_text: e.target.value })} className={inputCls} placeholder="https://..."/></Field>
            <Field label="Video URLs (one per line)"><textarea data-testid="f-videos" rows={2} value={form.videos_text} onChange={(e) => setForm({ ...form, videos_text: e.target.value })} className={inputCls} placeholder="https://..."/></Field>
            <Field label="Brochure PDF URL"><input data-testid="f-brochure" value={form.brochure_url} onChange={(e) => setForm({ ...form, brochure_url: e.target.value })} className={inputCls} /></Field>
            <Field label="Includes (one per line)"><textarea data-testid="f-includes" rows={4} value={form.decorations_text} onChange={(e) => setForm({ ...form, decorations_text: e.target.value })} className={inputCls} placeholder="Balloon Arch&#10;Welcome Board&#10;Cake Table"/></Field>
            <Field label="Add-ons (comma separated)"><textarea data-testid="f-addons" rows={2} value={form.addons_text} onChange={(e) => setForm({ ...form, addons_text: e.target.value })} className={inputCls} placeholder="LED Lights, Photo Props, Fog Machine"/></Field>
            <Field label="Tags (comma separated)"><input data-testid="f-tags" value={form.tags_text} onChange={(e) => setForm({ ...form, tags_text: e.target.value })} className={inputCls} placeholder="birthday, kids, gold"/></Field>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold">Cancel</button>
              <button type="submit" data-testid="submit-pkg" className="px-6 py-3 rounded-full bg-[#E63946] text-white font-semibold">{editingId ? "Save" : "Create"}</button>
            </div>
          </form>
        </div>
      )}

      {/* WA SEND POPUP */}
      {wa && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={sendPkgToNumber} className="bg-white w-full max-w-sm rounded-3xl p-6 space-y-3" data-testid="wa-send">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#E63946]">Send via WhatsApp</p>
                <h3 className="font-display text-xl font-bold">{wa.pkg.name}</h3>
              </div>
              <button type="button" onClick={() => setWa(null)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <input required autoFocus data-testid="wa-number" placeholder="Customer number (e.g. 919845xxxxxx)" value={wa.phone} onChange={(e) => setWa({ ...wa, phone: e.target.value })} className={inputCls} />
            <button type="submit" data-testid="wa-confirm" className="w-full py-3 rounded-full bg-[#E63946] text-white font-semibold flex items-center justify-center gap-2"><Send size={16} /> Send Now</button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============ SUB-COMPONENTS ============ */

const StatCard = ({ icon, iconBg, label, value, trend, trendColor, spark, testid }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
    className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-lg transition-shadow"
    data-testid={testid}
  >
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>{icon}</div>
    <p className="text-xs text-black/50 mb-1">{label}</p>
    <p className="font-display text-3xl font-black tracking-tight text-black mb-2">{value}</p>
    <div className="flex items-center justify-between">
      <p className={`text-[10px] font-semibold ${trendColor}`}>↑ {trend}</p>
      <MiniSpark color={spark} />
    </div>
  </motion.div>
);

const MiniSpark = ({ color }) => {
  // Deterministic pseudo-random path for demo aesthetic
  const points = [4, 8, 6, 14, 10, 18, 12, 22, 20];
  const w = 64, h = 20;
  const step = w / (points.length - 1);
  const max = Math.max(...points);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-90">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const TabBtn = ({ active, onClick, label, count, testid }) => (
  <button
    onClick={onClick} data-testid={testid}
    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap transition-all ${
      active ? "bg-white border-[#E63946] text-[#E63946] shadow-sm" : "bg-transparent border-transparent text-black/50 hover:text-black hover:bg-black/5"
    }`}
  >
    {label}
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-black/5 text-black" : "bg-black/10 text-black/60"}`}>{count}</span>
  </button>
);

const PkgCard = ({ p, kpi, status, badge, onClick, onSend, onEdit, onDel, onBook, onDup, onArchive, view, cover }) => {
  const savings = p.offer_price && p.price > p.offer_price ? Math.round(((p.price - p.offer_price) / p.price) * 100) : 0;
  const [menu, setMenu] = React.useState(false);
  if (view === "list") {
    return (
      <div data-testid={`pkg-card-${p.id}`} onClick={onClick} className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer flex gap-4 items-center">
        <PkgCover cover={cover} name={p.name} className="w-32 h-20" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-bold text-lg text-black truncate">{p.name}</p>
            <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${statusChip(status)}`}>{status}</span>
          </div>
          <p className="text-xs text-black/50 truncate">{p.description || "—"}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="font-bold text-black">{money(p.offer_price || p.price)}</p>
            {savings > 0 && <><p className="text-xs line-through text-black/40">{money(p.price)}</p><span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 rounded">{savings}% OFF</span></>}
          </div>
        </div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={onSend} data-testid={`send-${p.id}`} className="bg-[#E63946] text-white rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-1 hover:bg-[#D90429]"><MessageCircle size={12} /> Send</button>
          <button onClick={onEdit} className="border border-black/10 rounded-xl px-3 py-2 text-xs font-semibold hover:border-black"><Edit3 size={12} /></button>
        </div>
      </div>
    );
  }
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      data-testid={`pkg-card-${p.id}`}
      onClick={onClick}
      className="bg-white border border-black/[0.06] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-xl transition-shadow cursor-pointer flex flex-col group"
    >
      {/* Cover */}
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-[#FFE5E8] to-[#FFB6C1]">
        {cover ? (
          <img src={cover} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl font-black text-[#E63946]/20">{(p.name || "?")[0]}</div>
        )}
        {/* Bottom gradient overlay */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        {/* Top-left badge */}
        {badge && (
          <span className={`absolute top-3 left-3 text-[9px] font-black tracking-widest px-2.5 py-1 rounded-md shadow-md ${BADGE_STYLES[badge] || "bg-black text-white"}`}>
            {badge}
          </span>
        )}
        {/* Top-right status */}
        <span className={`absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md border ${statusChip(status)} bg-white/95 backdrop-blur-sm`}>{status}</span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2.5 flex-1 flex flex-col">
        <div>
          <p className="font-display text-xl font-black tracking-tight text-black truncate">{p.name}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-black text-[#E63946]">{money(p.offer_price || p.price)}</p>
            {(p.offer_price && p.price > p.offer_price) && (
              <>
                <p className="text-sm line-through text-black/40">{money(p.price)}</p>
                <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">{Math.round(((p.price - p.offer_price) / p.price) * 100)}% OFF</span>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {p.description && <p className="text-xs text-black/60 line-clamp-2">{p.description}</p>}

        {/* Features */}
        {p.decorations?.length > 0 && (
          <ul className="space-y-1">
            {p.decorations.slice(0, 4).map((d) => (
              <li key={d} className="flex items-center gap-1.5 text-xs text-black/70">
                <Check size={12} className="text-green-600 flex-shrink-0" /> <span className="truncate">{d}</span>
              </li>
            ))}
            {p.decorations.length > 4 && <li className="text-[11px] text-[#E63946] font-semibold">+ {p.decorations.length - 4} more</li>}
          </ul>
        )}

        {/* Gallery indicators */}
        <div className="flex gap-3 text-[11px] text-black/50 pt-1">
          <span className="flex items-center gap-1"><ImageIcon size={12} /> {(p.photos?.length || 0)}</span>
          <span className="flex items-center gap-1"><Video size={12} /> {(p.videos?.length || 0)}</span>
          <span className="flex items-center gap-1"><FileText size={12} /> {p.brochure_url ? "PDF" : "—"}</span>
        </div>

        {/* KPI chips */}
        <div className="grid grid-cols-3 gap-1.5 py-2 border-y border-black/5">
          <KpiChip label="Bookings" value={kpi.bookings} />
          <KpiChip label="Revenue" value={compact(kpi.revenue)} />
          <KpiChip label="Conv." value={`${kpi.conversion_rate}%`} highlight />
        </div>

        {/* Actions */}
        <div className="flex gap-2 items-center mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onSend} data-testid={`send-${p.id}`}
            className="flex-1 bg-[#E63946] hover:bg-[#D90429] text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm shadow-red-500/20"
          >
            <MessageCircle size={13} /> Send via WhatsApp
          </button>
          <div className="relative">
            <button onClick={() => setMenu((v) => !v)} data-testid={`menu-${p.id}`} className="p-2.5 rounded-xl border border-black/10 hover:bg-black/5 transition-colors"><MoreHorizontal size={14} /></button>
            {menu && (
              <div onMouseLeave={() => setMenu(false)} className="absolute right-0 bottom-full mb-1 bg-white border border-black/10 rounded-xl shadow-xl overflow-hidden py-1 w-40 z-10">
                <MenuItem icon={<Eye size={12} />} label="Preview" onClick={() => { setMenu(false); onClick(); }} />
                <MenuItem icon={<ShoppingBag size={12} />} label="Create Booking" onClick={() => { setMenu(false); onBook(); }} />
                <MenuItem icon={<Edit3 size={12} />} label="Edit" onClick={() => { setMenu(false); onEdit(); }} />
                <MenuItem icon={<Copy size={12} />} label="Duplicate" onClick={() => { setMenu(false); onDup(); }} />
                <MenuItem icon={<Archive size={12} />} label="Archive" onClick={() => { setMenu(false); onArchive(); }} />
                <MenuItem icon={<Trash2 size={12} />} label="Delete" danger onClick={() => { setMenu(false); onDel(); }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const PkgCover = ({ cover, name, className }) => (
  <div className={`rounded-xl overflow-hidden bg-gradient-to-br from-[#FFE5E8] to-[#FFB6C1] flex-shrink-0 ${className}`}>
    {cover ? (
      <img src={cover} alt={name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = "none"; }} />
    ) : (
      <div className="w-full h-full flex items-center justify-center text-2xl font-black text-[#E63946]/30">{(name || "?")[0]}</div>
    )}
  </div>
);

const KpiChip = ({ label, value, highlight }) => (
  <div className="text-center">
    <p className="text-[9px] font-bold uppercase text-black/40 tracking-wide">{label}</p>
    <p className={`text-sm font-black ${highlight ? "text-green-600" : "text-black"}`}>{value}</p>
  </div>
);

const MenuItem = ({ icon, label, onClick, danger }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold ${danger ? "text-[#E63946] hover:bg-red-50" : "text-black hover:bg-black/[0.04]"}`}>
    {icon} {label}
  </button>
);

/* ---- DRAWER ---- */
const PkgDrawer = ({ p, kpi, status, badge, imgIdx, setImgIdx, onClose, onSend, onEdit, onBook, onDup, onArchive }) => {
  const gallery = useMemo(() => {
    const arr = [];
    if (p.cover_image) arr.push(p.cover_image);
    (p.photos || []).forEach((x) => { if (x && !arr.includes(x)) arr.push(x); });
    return arr;
  }, [p]);
  const current = gallery[imgIdx] || null;
  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md px-5 py-4 flex items-center justify-between border-b border-black/5">
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl font-black tracking-tight truncate">{p.name}</h2>
          <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border mt-1 ${statusChip(status)}`}>{status}</span>
        </div>
        <button onClick={onClose} data-testid="drawer-close" className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
      </div>

      {/* Image carousel */}
      <div className="relative aspect-video bg-gradient-to-br from-[#FFE5E8] to-[#FFB6C1]">
        {current ? (
          <img src={current} alt={p.name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-8xl font-black text-[#E63946]/20">{(p.name || "?")[0]}</div>
        )}
        {badge && (
          <span className={`absolute top-4 left-4 text-[10px] font-black tracking-widest px-3 py-1.5 rounded-md shadow-md ${BADGE_STYLES[badge] || "bg-black text-white"}`}>{badge}</span>
        )}
        {gallery.length > 1 && (
          <>
            <button onClick={() => setImgIdx((imgIdx - 1 + gallery.length) % gallery.length)} className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur rounded-full p-2 hover:bg-white shadow-md"><ChevronLeft size={16} /></button>
            <button onClick={() => setImgIdx((imgIdx + 1) % gallery.length)} className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur rounded-full p-2 hover:bg-white shadow-md"><ChevronRight size={16} /></button>
            <span className="absolute top-4 right-4 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded">{imgIdx + 1}/{gallery.length}</span>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {gallery.length > 1 && (
        <div className="px-5 py-3 flex gap-2 overflow-x-auto">
          {gallery.slice(0, 5).map((src, i) => (
            <button key={i} onClick={() => setImgIdx(i)} className={`w-16 h-16 rounded-lg overflow-hidden border-2 flex-shrink-0 ${i === imgIdx ? "border-[#E63946]" : "border-transparent"}`}>
              <img src={src} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = "none"; }} />
            </button>
          ))}
          {gallery.length > 5 && <div className="w-16 h-16 rounded-lg bg-black/70 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">+{gallery.length - 5}</div>}
        </div>
      )}

      {/* Body */}
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Price</p><p className="font-black text-2xl text-[#E63946]">{money(p.price)}</p></div>
          {p.offer_price && (<div><p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Offer Price</p><p className="font-black text-2xl text-[#E63946]">{money(p.offer_price)} <span className="text-xs font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded ml-1">{Math.round(((p.price - p.offer_price) / p.price) * 100)}% OFF</span></p></div>)}
        </div>

        {p.description && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-1">Description</p>
            <p className="text-sm text-black/80">{p.description}</p>
          </div>
        )}

        {p.decorations?.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Includes</p>
              <p className="text-[11px] text-black/50">{p.decorations.length} items</p>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5">
              {p.decorations.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 text-sm text-black/80"><Check size={14} className="text-green-600 flex-shrink-0" /> {d}</div>
              ))}
            </div>
          </div>
        )}

        {p.addons?.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Add-ons available {p.max_addons ? `(pick up to ${p.max_addons})` : ""}</p>
            <div className="flex flex-wrap gap-1.5">
              {p.addons.map((a) => <span key={a} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#FFE5E8] text-[#E63946]">{a}</span>)}
            </div>
          </div>
        )}

        {/* Analytics grid */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-black/5">
          <DrawerKpi icon={<MessageCircle size={14} className="text-green-600" />} label="Sent via WhatsApp" value={kpi.sent_via_whatsapp} />
          <DrawerKpi icon={<ShoppingBag size={14} className="text-purple-600" />} label="Bookings" value={kpi.bookings} />
          <DrawerKpi icon={<IndianRupee size={14} className="text-amber-600" />} label="Revenue" value={compact(kpi.revenue)} />
          <DrawerKpi icon={<TrendingUp size={14} className="text-blue-600" />} label="Conversion" value={`${kpi.conversion_rate}%`} />
        </div>

        {/* WhatsApp Preview mockup */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">WhatsApp preview</p>
          <div className="mx-auto max-w-[280px] bg-black rounded-[36px] p-2 shadow-2xl">
            <div className="bg-[#ECE5DD] rounded-[28px] p-3 min-h-[420px] flex flex-col">
              <div className="text-center text-[9px] text-black/50 mb-2">Today · 3:24 PM</div>
              <div className="bg-white rounded-2xl rounded-bl-sm p-2 max-w-[220px] shadow-sm">
                {gallery[0] && <img src={gallery[0]} alt="" className="rounded-lg mb-2 w-full h-32 object-cover" />}
                <p className="text-[11px] font-bold text-black">*{p.name}* — {money(p.offer_price || p.price)}</p>
                {p.description && <p className="text-[10px] text-black/70 mt-1 line-clamp-3">{p.description}</p>}
                {p.decorations?.length > 0 && (
                  <div className="mt-1.5 text-[9px] text-black/70">
                    <p className="italic">Includes:</p>
                    {p.decorations.slice(0, 3).map((d) => <p key={d}>• {d}</p>)}
                  </div>
                )}
                <div className="mt-2 flex gap-1">
                  <span className="text-[9px] font-bold bg-[#25D366] text-white px-2 py-0.5 rounded">📅 Book Now</span>
                  <span className="text-[9px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded flex items-center gap-1"><Phone size={8} /> Call</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2">Quick actions</p>
          <button onClick={onSend} data-testid="drawer-send" className="w-full mb-2 bg-[#E63946] hover:bg-[#D90429] text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 shadow-md shadow-red-500/20"><MessageCircle size={16} /> Send via WhatsApp</button>
          <div className="grid grid-cols-2 gap-2">
            <QuickAct icon={<ShoppingBag size={14} />} label="Create Booking" onClick={onBook} testid="drawer-book" />
            <QuickAct icon={<Receipt size={14} />} label="Payment Link" onClick={() => toast.info("Pick a customer booking first")} />
            <QuickAct icon={<FileText size={14} />} label="Generate Invoice" onClick={() => toast.info("Pick a customer booking first")} />
            <QuickAct icon={<QrCode size={14} />} label="Show QR Code" onClick={() => toast.info("Pick a customer booking first")} />
            <QuickAct icon={<Copy size={14} />} label="Duplicate Package" onClick={onDup} testid="drawer-dup" />
            <QuickAct icon={<Archive size={14} />} label="Archive" onClick={onArchive} testid="drawer-archive" />
          </div>
          <button onClick={onEdit} data-testid="drawer-edit" className="w-full mt-2 border border-black/10 hover:border-black rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"><Edit3 size={14} /> Edit Package</button>
        </div>
      </div>
    </div>
  );
};

const DrawerKpi = ({ icon, label, value }) => (
  <div className="text-center p-2">
    <div className="w-8 h-8 rounded-full bg-black/[0.04] mx-auto flex items-center justify-center mb-1">{icon}</div>
    <p className="text-[9px] font-bold uppercase text-black/40 tracking-wide">{label}</p>
    <p className="text-sm font-black text-black">{value}</p>
  </div>
);

const QuickAct = ({ icon, label, onClick, testid }) => (
  <button onClick={onClick} data-testid={testid} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-black/10 hover:border-black hover:bg-black/[0.02] text-xs font-semibold transition-colors text-left">
    <span className="w-6 h-6 rounded-full bg-black/[0.05] flex items-center justify-center flex-shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

/* ---- HELPERS ---- */
const inputCls = "w-full bg-white border border-black/10 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all";
const Field = ({ label, children }) => (
  <div>
    <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">{label}</label>
    {children}
  </div>
);

const empty = () => ({
  name: "", price: "", offer_price: "", description: "", cover_image: "",
  decorations_text: "", addons_text: "", max_addons: 0,
  photos_text: "", videos_text: "", brochure_url: "",
  tags_text: "", badge: "", status: "Active", active: true,
});
