import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@rcbevents.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back!");
      navigate("/");
    } catch (err) {
      const msg = err.response?.data?.detail || "Login failed";
      toast.error(typeof msg === "string" ? msg : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 relative overflow-hidden">
      {/* Decorative shapes */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#E63946]/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-black/5 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-[#E63946] flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-red-500/30">
              R
            </div>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tighter text-black mb-2">
            RCB Events <span className="text-[#E63946]">CRM</span>
          </h1>
          <p className="text-black/60 text-sm">Sign in to manage your events business</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-black/5 rounded-3xl p-8 shadow-xl shadow-black/5 space-y-5"
          data-testid="login-form"
        >
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-2 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="login-email-input"
              className="w-full bg-white border border-black/10 rounded-xl px-4 py-3 text-black focus:outline-none focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all"
              placeholder="admin@rcbevents.com"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-black/60 mb-2 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password-input"
              className="w-full bg-white border border-black/10 rounded-xl px-4 py-3 text-black focus:outline-none focus:ring-2 focus:ring-[#E63946] focus:border-transparent transition-all"
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit-button"
            className="w-full bg-[#E63946] hover:bg-[#D90429] text-white rounded-full py-3.5 font-semibold transition-all duration-200 active:scale-95 shadow-md shadow-red-500/20 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? "Signing in..." : (<><Sparkles size={18} /> Sign in</>)}
          </button>
          <p className="text-xs text-center text-black/50">
            Default: admin@rcbevents.com / admin123
          </p>
        </form>
      </div>
    </div>
  );
}
