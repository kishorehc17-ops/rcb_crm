import React from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import { LayoutDashboard, Users, Package, Receipt, Wallet, UserCog, Sparkles, LogOut, Shield, BarChart3 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";

const allNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", roles: ["admin", "manager", "sales", "staff"] },
  { to: "/bookings", label: "Bookings", icon: Package, testid: "nav-bookings", roles: ["admin", "manager", "sales", "staff"] },
  { to: "/pipeline", label: "Pipeline", icon: Sparkles, testid: "nav-pipeline", roles: ["admin", "manager", "sales"] },
  { to: "/packages", label: "Packages", icon: Package, testid: "nav-packages", roles: ["admin", "manager", "sales"] },
  { to: "/payments", label: "Payments", icon: Wallet, testid: "nav-payments", roles: ["admin", "manager"] },
  { to: "/expenses", label: "Expenses", icon: Receipt, testid: "nav-expenses", roles: ["admin", "manager"] },
  { to: "/reports", label: "Reports", icon: BarChart3, testid: "nav-reports", roles: ["admin", "manager"] },
  { to: "/vendors", label: "Vendors", icon: Users, testid: "nav-vendors", roles: ["admin", "manager"] },
  { to: "/staff", label: "Staff", icon: UserCog, testid: "nav-staff", roles: ["admin", "manager"] },
  { to: "/users", label: "Users", icon: Shield, testid: "nav-users", roles: ["admin"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = allNav.filter((n) => n.roles.includes(user?.role || "staff"));
  const mobileNavItems = navItems.slice(0, 5);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-black/5 bg-white sticky top-0 h-screen">
        <div className="p-6 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E63946] flex items-center justify-center text-white font-black text-lg">R</div>
            <div>
              <h1 className="font-display font-black text-lg text-black leading-tight">RCB Events</h1>
              <p className="text-xs text-black/50 uppercase tracking-widest">CRM</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={item.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-[#E63946] text-white shadow-md shadow-red-500/20"
                    : "text-black/70 hover:bg-black/5 hover:text-black"
                }`
              }
            >
              <item.icon size={20} strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-black/5">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white font-bold">
              {user?.name?.[0]?.toUpperCase() || "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-black truncate">{user?.name}</p>
              <p className="text-xs text-black/50 truncate">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              data-testid="logout-btn"
              className="p-2 rounded-lg hover:bg-red-50 text-black/50 hover:text-[#E63946] transition-colors"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-0">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-black/5 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#E63946] flex items-center justify-center text-white font-black text-sm">R</div>
            <span className="font-display font-black text-black">RCB Events</span>
          </div>
          <button
            onClick={handleLogout}
            data-testid="mobile-logout-btn"
            className="p-2 rounded-lg text-black/60 hover:text-[#E63946]"
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-xl border-t border-black/5 z-50 flex items-center justify-around px-2">
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            data-testid={`mobile-${item.testid}`}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-colors ${
                isActive ? "text-[#E63946]" : "text-black/50"
              }`
            }
          >
            <item.icon size={20} strokeWidth={2} />
            <span className="text-[10px] font-semibold">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
