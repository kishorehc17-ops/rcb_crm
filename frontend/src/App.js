import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Bookings from "@/pages/Bookings";
import Packages from "@/pages/Packages";
import Payments from "@/pages/Payments";
import Expenses from "@/pages/Expenses";
import Vendors from "@/pages/Vendors";
import Staff from "@/pages/Staff";
import Pipeline from "@/pages/Pipeline";
import Invoice from "@/pages/Invoice";
import Users from "@/pages/Users";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/vendors" element={<Vendors />} />
              <Route path="/staff" element={<Staff />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/users" element={<Users />} />
              <Route path="/invoice/:id" element={<Invoice />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
