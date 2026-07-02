import React, { useEffect, useState } from "react";
import api from "@/api";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";

const ROLES = ["admin", "manager", "sales", "staff"];
const empty = { email: "", password: "", name: "", role: "staff" };

export default function Users() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);

  const load = () => api.get("/users").then((r) => setRows(r.data)).catch(() => toast.error("Access denied"));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try { await api.post("/users", form); toast.success("User created"); setShow(false); setForm(empty); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };
  const del = async (id) => { if (!window.confirm("Delete user?")) return; await api.delete(`/users/${id}`); load(); };

  const roleColor = (r) => ({ admin: "bg-[#E63946] text-white", manager: "bg-black text-white",
    sales: "bg-yellow-100 text-yellow-800", staff: "bg-blue-100 text-blue-800" }[r] || "bg-black/10");

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#E63946] mb-2">Team</p>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black">User Management</h1>
        </div>
        <button data-testid="new-user-btn" onClick={() => setShow(true)} className="bg-[#E63946] hover:bg-[#D90429] text-white rounded-full px-6 py-3 font-semibold flex items-center gap-2 shadow-md shadow-red-500/20"><Plus size={18} /> Add User</button>
      </div>
      <div className="bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-black/[0.02] text-xs uppercase tracking-widest text-black/50">
            <tr><th className="text-left px-6 py-4">Name</th><th className="text-left px-6 py-4">Email</th><th className="text-left px-6 py-4">Role</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-black/5">
                <td className="px-6 py-4 font-semibold">{u.name}</td>
                <td className="px-6 py-4 text-sm text-black/70">{u.email}</td>
                <td className="px-6 py-4"><span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${roleColor(u.role)}`}>{u.role}</span></td>
                <td className="px-6 py-4 text-right"><button data-testid={`del-user-${u.id}`} onClick={() => del(u.id)} className="p-2 rounded-lg hover:bg-red-50 text-[#E63946]"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white w-full max-w-md rounded-3xl p-6 space-y-3">
            <div className="flex justify-between"><h2 className="font-display text-2xl font-bold">New User</h2><button type="button" onClick={() => setShow(false)}><X size={20} /></button></div>
            <input required placeholder="Name" data-testid="u-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required type="email" placeholder="Email" data-testid="u-email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <input required type="password" placeholder="Password" data-testid="u-password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5" />
            <select data-testid="u-role" value={form.role} onChange={(e) => setForm({...form, role: e.target.value})} className="w-full border border-black/10 rounded-xl px-4 py-2.5">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="submit" data-testid="submit-user" className="w-full bg-[#E63946] text-white rounded-full py-3 font-semibold">Create</button>
          </form>
        </div>
      )}
    </div>
  );
}
