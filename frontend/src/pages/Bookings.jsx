import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "@/api";
import { toast } from "sonner";
import { Trash2, Edit3, MessageCircle, FileText, X, Plus, Search, Eye, Upload } from "lucide-react";

const STATUSES = ["Inquiry", "Pending", "Confirmed", "In Progress", "Completed", "Cancelled"];

const statusColor = (s) => ({
  "Inquiry": "bg-black/10 text-black",
  "Pending": "bg-[#FFE5E8] text-[#E63946]",
  "Confirmed": "bg-green-100 text-green-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "Completed": "bg-black text-white",
  "Cancelled": "bg-red-100 text-red-700",
}[s] || "bg-black/10 text-black");

const emptyForm = {
  customer_name: "", mobile: "", event_date: "", event_time: "18:00",
  location: "", theme: "", theme_photo: "", package_id: "", package_name: "",
  selected_addons: [],
  special_requirements: "", status: "Inquiry", total_amount: 0, advance_paid: 0,
};

export default function Bookings() {
  const [rows, setRows] = useState([]);
  const [packages, setPackages] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [uploading, setUploading] = useState(false);

  const BACKEND = process.env.REACT_APP_BACKEND_URL;
  const photoUrl = (p) => (p && p.startsWith("http") ? p : p ? `${BACKEND}${p}` : "");

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, theme_photo: res.data.url }));
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const load = async () => {
    const r = await api.get("/bookings");
    setRows(r.data);
  };

  useEffect(() => {
    load();
    api.get("/packages", { params: { active_only: true } }).then((r) => setPackages(r.data));
    if (params.get("new")) setShowForm(true);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, selected_addons: form.selected_addons || [], total_amount: Number(form.total_amount), advance_paid: Number(form.advance_paid) };
      if (editingId) {
        await api.put(`/bookings/${editingId}`, payload);
        toast.success("Booking updated");
      } else {
        await api.post("/bookings", payload);
        toast.success("Booking created");
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error("Failed to save booking");
    }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this booking?")) return;
    await api.delete(`/bookings/${id}`);
    toast.success("Deleted");
    load();
  };

  const edit = (b) => {
    setForm({ ...b, selected_addons: b.selected_addons || [] });
    setEditingId(b.id);
    setShowForm(true);
  };

  const selectedPkg = packages.find((p) => p.id === form.package_id);
  const addonLimit = selectedPkg?.max_addons || 0;
  const availableAddons = selectedPkg?.addons || [];
  const toggleAddon = (addon) => {
    const cur = form.selected_addons || [];
    if (cur.includes(addon)) {
      setForm({ ...form, selected_addons: cur.filter((a) => a !== addon) });
    } else {
      if (cur.length >= addonLimit) {
        toast.error(`You can select up to ${addonLimit} add-ons for this package`);
        return;
      }
      setForm({ ...form, selected_addons: [...cur, addon] });
    }
  };

  const filtered = rows.filter((b) => {
    const q = search.toLowerCase();
    const matchQ = !q || b.customer_name?.toLowerCase().includes(q) || b.mobile?.includes(q) || b.booking_number?.toLowerCase().includes(q);
    const matchS = filterStatus === "All" || b.status === filterStatus;
    return matchQ && matchS;
  });

  const wa = (mobile, name) => {
    const msg = encodeURIComponent(`Hi ${name}, this is RCB Events. Thank you for your booking!`);
    const num = mobile.replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
  };

  return (
    <div className="space-y-6" data-testid="bookings-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Bookings</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">Manage Events</h1>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true); }}
          data-testid="new-booking-btn"
          className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold transition-all active:scale-95 shadow-md shadow-red-500/20 flex items-center gap-2"
        >
          <Plus size={18} /> New Booking
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
          <input
            data-testid="booking-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, booking #"
            className="w-full bg-white border border-black/10 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E63946]"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {["All", ...STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              data-testid={`filter-${s}`}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                filterStatus === s ? "bg-black text-white" : "bg-white border border-black/10 text-black/70 hover:border-black"
              }`}
            >{s}</button>
          ))}
        </div>
      </div>

      {/* Table (desktop) / Cards (mobile) */}
      <div className="hidden md:block bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-black/[0.02] text-xs uppercase tracking-widest text-black/50">
            <tr>
              <th className="text-left px-6 py-4">Booking #</th>
              <th className="text-left px-6 py-4">Customer</th>
              <th className="text-left px-6 py-4">Event</th>
              <th className="text-left px-6 py-4">Theme</th>
              <th className="text-left px-6 py-4">Package</th>
              <th className="text-left px-6 py-4">Amount</th>
              <th className="text-left px-6 py-4">Status</th>
              <th className="text-right px-6 py-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-black/50">No bookings found.</td></tr>
            )}
            {filtered.map((b) => (
              <tr key={b.id} className="border-t border-black/5 hover:bg-black/[0.01]">
                <td className="px-6 py-4 font-mono text-xs text-black/60">{b.booking_number}</td>
                <td className="px-6 py-4">
                  <p className="font-semibold text-black">{b.customer_name}</p>
                  <p className="text-xs text-black/50">{b.mobile}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-black">{b.event_date}</p>
                  <p className="text-xs text-black/50">{b.event_time}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2.5">
                    {b.theme_photo ? (
                      <img src={photoUrl(b.theme_photo)} alt={b.theme} className="w-10 h-10 rounded-xl object-cover border border-black/10 flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#FFE5E8] flex items-center justify-center flex-shrink-0 text-[#E63946] font-bold text-sm">
                        {(b.theme || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <p className="text-sm font-semibold text-black">{b.theme || "—"}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {b.package_name && (
                    <p className="text-sm font-bold text-black">{b.package_name}</p>
                  )}
                  {b.selected_addons && b.selected_addons.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {b.selected_addons.slice(0, 3).map((a) => (
                        <span key={a} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#FFE5E8] text-[#E63946]">{a}</span>
                      ))}
                      {b.selected_addons.length > 3 && (
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-black/5 text-black/60">+{b.selected_addons.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    !b.package_name && <span className="text-xs text-black/40">—</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm font-bold text-black">₹{Number(b.total_amount).toLocaleString("en-IN")}</p>
                  <p className="text-xs text-black/50">Bal: ₹{(Number(b.total_amount) - Number(b.advance_paid)).toLocaleString("en-IN")}</p>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${statusColor(b.status)}`}>{b.status}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setViewing(b)} data-testid={`view-${b.id}`} title="View" className="p-2 rounded-lg hover:bg-black/5"><Eye size={16} /></button>
                    <button onClick={() => wa(b.mobile, b.customer_name)} data-testid={`wa-${b.id}`} title="WhatsApp" className="p-2 rounded-lg hover:bg-green-50 text-green-600"><MessageCircle size={16} /></button>
                    <button onClick={() => navigate(`/invoice/${b.id}`)} data-testid={`invoice-${b.id}`} title="Invoice" className="p-2 rounded-lg hover:bg-black/5"><FileText size={16} /></button>
                    <button onClick={() => edit(b)} data-testid={`edit-${b.id}`} title="Edit" className="p-2 rounded-lg hover:bg-black/5"><Edit3 size={16} /></button>
                    <button onClick={() => del(b.id)} data-testid={`delete-${b.id}`} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-[#E63946]"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && <p className="text-center py-12 text-black/50">No bookings found.</p>}
        {filtered.map((b) => (
          <div key={b.id} className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="min-w-0">
                <p className="font-semibold text-black">{b.customer_name}</p>
                <p className="text-xs text-black/50">{b.mobile} · {b.booking_number}</p>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${statusColor(b.status)}`}>{b.status}</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              {b.theme_photo ? (
                <img src={photoUrl(b.theme_photo)} alt={b.theme} className="w-14 h-14 rounded-xl object-cover border border-black/10 flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[#FFE5E8] flex items-center justify-center flex-shrink-0 text-[#E63946] font-bold text-lg">
                  {(b.theme || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Theme</p>
                <p className="text-sm font-semibold text-black truncate">{b.theme || "—"}</p>
                <p className="text-xs text-black/50">{b.event_date} · {b.event_time}</p>
              </div>
            </div>
            {(b.package_name || (b.selected_addons && b.selected_addons.length > 0)) && (
              <div className="mb-3 p-3 rounded-xl bg-black/[0.02]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/40">Package</p>
                {b.package_name && <p className="text-sm font-bold text-black">{b.package_name}</p>}
                {b.selected_addons && b.selected_addons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {b.selected_addons.map((a) => (
                      <span key={a} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#FFE5E8] text-[#E63946]">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-sm font-bold text-black">₹{Number(b.total_amount).toLocaleString("en-IN")}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setViewing(b)} data-testid={`m-view-${b.id}`} className="flex-1 bg-black text-white rounded-full py-2 text-xs font-semibold flex items-center justify-center gap-1"><Eye size={14} /> View</button>
              <button onClick={() => wa(b.mobile, b.customer_name)} className="flex-1 bg-green-50 text-green-700 rounded-full py-2 text-xs font-semibold flex items-center justify-center gap-1"><MessageCircle size={14} /> WhatsApp</button>
              <button onClick={() => edit(b)} className="flex-1 bg-black/5 rounded-full py-2 text-xs font-semibold flex items-center justify-center gap-1"><Edit3 size={14} /> Edit</button>
              <button onClick={() => del(b.id)} className="bg-red-50 text-[#E63946] rounded-full px-3 py-2"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-2xl font-bold tracking-tight text-black">{editingId ? "Edit" : "New"} Booking</h2>
              <button data-testid="close-form" onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>
            <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Customer Name" required>
                <input required data-testid="form-name" value={form.customer_name} onChange={(e) => setForm({...form, customer_name: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Mobile Number" required>
                <input required data-testid="form-mobile" value={form.mobile} onChange={(e) => setForm({...form, mobile: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Event Date" required>
                <input required type="date" data-testid="form-date" value={form.event_date} onChange={(e) => setForm({...form, event_date: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Event Time">
                <input type="time" data-testid="form-time" value={form.event_time} onChange={(e) => setForm({...form, event_time: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Location" className="sm:col-span-2">
                <input data-testid="form-location" value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Theme">
                <input data-testid="form-theme" value={form.theme} onChange={(e) => setForm({...form, theme: e.target.value})} className={inputCls} placeholder="e.g. Spiderman, Unicorn" />
              </Field>
              <Field label="Theme Photo / Reference Image">
                <div className="flex items-center gap-3">
                  {form.theme_photo && (
                    <img src={photoUrl(form.theme_photo)} alt="preview" className="w-14 h-14 rounded-xl object-cover border border-black/10" />
                  )}
                  <label className={`flex-1 cursor-pointer flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-black/15 hover:border-[#E63946] hover:bg-red-50/40 transition-all font-semibold text-sm ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                    <Upload size={16} />
                    {uploading ? "Uploading..." : form.theme_photo ? "Replace photo" : "Upload photo"}
                    <input data-testid="form-theme-photo-file" type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                  </label>
                  {form.theme_photo && (
                    <button type="button" onClick={() => setForm({...form, theme_photo: ""})} className="p-2 rounded-lg text-[#E63946] hover:bg-red-50" title="Remove">
                      <X size={16} />
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Package">
                <select data-testid="form-package" value={form.package_id} onChange={(e) => {
                  const p = packages.find((pk) => pk.id === e.target.value);
                  setForm({...form, package_id: e.target.value, package_name: p?.name || "", selected_addons: [], total_amount: p?.price || form.total_amount});
                }} className={inputCls}>
                  <option value="">Select package</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>)}
                </select>
              </Field>
              {selectedPkg && availableAddons.length > 0 && (
                <Field label={`Add-ons (select up to ${addonLimit})`} className="sm:col-span-2">
                  <div className="border border-black/10 rounded-xl p-3 bg-white" data-testid="form-addons">
                    <div className="flex flex-wrap gap-2">
                      {availableAddons.map((addon) => {
                        const selected = (form.selected_addons || []).includes(addon);
                        return (
                          <button
                            key={addon}
                            type="button"
                            data-testid={`addon-${addon.replace(/\s+/g, '-')}`}
                            onClick={() => toggleAddon(addon)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                              selected
                                ? "bg-[#E63946] text-white shadow-md shadow-red-500/20"
                                : "bg-black/5 text-black/70 hover:bg-black/10"
                            }`}
                          >
                            {selected ? "✓ " : "+ "}{addon}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-black/50 mt-2">{(form.selected_addons || []).length} / {addonLimit} selected</p>
                  </div>
                </Field>
              )}
              <Field label="Total Amount (₹)">
                <input type="number" data-testid="form-total" value={form.total_amount} onChange={(e) => setForm({...form, total_amount: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Advance Paid (₹)">
                <input type="number" data-testid="form-advance" value={form.advance_paid} onChange={(e) => setForm({...form, advance_paid: e.target.value})} className={inputCls} />
              </Field>
              <Field label="Status">
                <select data-testid="form-status" value={form.status} onChange={(e) => setForm({...form, status: e.target.value})} className={inputCls}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Special Requirements" className="sm:col-span-2">
                <textarea data-testid="form-req" value={form.special_requirements} onChange={(e) => setForm({...form, special_requirements: e.target.value})} rows={3} className={inputCls} />
              </Field>
              <div className="sm:col-span-2 flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-6 py-3 rounded-full border border-black/10 font-semibold hover:border-black">Cancel</button>
                <button type="submit" data-testid="submit-booking" className="px-6 py-3 rounded-full bg-[#E63946] hover:bg-[#D90429] text-white font-semibold shadow-md shadow-red-500/20 active:scale-95 transition-all">
                  {editingId ? "Update" : "Create"} Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View details modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="view-modal">
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-black/5">
              <div className="flex items-start gap-3">
                {viewing.theme_photo && (
                  <img src={viewing.theme_photo} alt={viewing.theme} className="w-16 h-16 rounded-2xl object-cover border border-black/10" onError={(e) => { e.target.style.display = 'none'; }} />
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-1">Booking Details</p>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-black">{viewing.customer_name}</h2>
                  <p className="text-xs font-mono text-black/50 mt-1">{viewing.booking_number}</p>
                </div>
              </div>
              <button data-testid="close-view" onClick={() => setViewing(null)} className="p-2 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <Info label="Status">
                <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full inline-block ${statusColor(viewing.status)}`}>{viewing.status}</span>
              </Info>
              <Info label="Mobile">{viewing.mobile}</Info>
              <Info label="Event Date">{viewing.event_date}</Info>
              <Info label="Event Time">{viewing.event_time}</Info>
              <Info label="Location" full>{viewing.location || "—"}</Info>
              <Info label="Theme">{viewing.theme || "—"}</Info>
              <Info label="Package">{viewing.package_name || "—"}</Info>
              <Info label="Total Amount">₹{Number(viewing.total_amount).toLocaleString("en-IN")}</Info>
              <Info label="Advance Paid">₹{Number(viewing.advance_paid).toLocaleString("en-IN")}</Info>
              <Info label="Balance" full>
                <span className="text-[#E63946] font-bold">₹{(Number(viewing.total_amount) - Number(viewing.advance_paid)).toLocaleString("en-IN")}</span>
              </Info>
              {viewing.selected_addons && viewing.selected_addons.length > 0 && (
                <Info label="Add-ons" full>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {viewing.selected_addons.map((a) => (
                      <span key={a} className="px-2.5 py-1 rounded-full bg-[#FFE5E8] text-[#E63946] text-xs font-semibold">{a}</span>
                    ))}
                  </div>
                </Info>
              )}
              {viewing.special_requirements && <Info label="Special Requirements" full>{viewing.special_requirements}</Info>}
              <Info label="Created" full>{new Date(viewing.created_at).toLocaleString()}</Info>
            </div>

            <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-black/5">
              <button data-testid="view-wa-btn" onClick={() => wa(viewing.mobile, viewing.customer_name)} className="px-4 py-2 rounded-full bg-green-50 text-green-700 font-semibold text-sm flex items-center gap-2"><MessageCircle size={14} /> WhatsApp</button>
              <button data-testid="view-invoice-btn" onClick={() => navigate(`/invoice/${viewing.id}`)} className="px-4 py-2 rounded-full bg-black/5 text-black font-semibold text-sm flex items-center gap-2"><FileText size={14} /> Invoice</button>
              <button data-testid="view-edit-btn" onClick={() => { edit(viewing); setViewing(null); }} className="px-4 py-2 rounded-full bg-black text-white font-semibold text-sm flex items-center gap-2"><Edit3 size={14} /> Edit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Info = ({ label, children, full }) => (
  <div className={full ? "col-span-2" : ""}>
    <p className="text-[10px] font-bold uppercase tracking-widest text-black/50 mb-1">{label}</p>
    <div className="text-sm text-black">{children}</div>
  </div>
);

const inputCls = "w-full bg-white border border-black/10 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all";

const Field = ({ label, children, className = "", required }) => (
  <div className={className}>
    <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-1.5 block">
      {label} {required && <span className="text-[#E63946]">*</span>}
    </label>
    {children}
  </div>
);
