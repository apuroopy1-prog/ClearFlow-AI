import { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import SessionTimeoutModal from "./components/SessionTimeoutModal";
import OnboardingModal from "./components/OnboardingModal";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Invoices from "./pages/Invoices";
import Forecasting from "./pages/Forecasting";
import Notifications from "./pages/Notifications";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

const SHORTCUTS = [
  { keys: "G → D", action: "Go to Dashboard" },
  { keys: "G → T", action: "Go to Transactions" },
  { keys: "G → I", action: "Go to Invoices" },
  { keys: "G → C", action: "Go to Chat" },
  { keys: "G → S", action: "Go to Settings" },
  { keys: "?", action: "Show this modal" },
];

const SHORTCUT_MAP = { d: "/", t: "/transactions", i: "/invoices", c: "/chat", s: "/settings" };

function KeyboardShortcutsModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex justify-between text-sm">
              <span className="font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">{s.keys}</span>
              <span className="text-gray-500 dark:text-gray-400">{s.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const pendingG = useRef(false);
  const gTimer = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;

      const key = e.key.toLowerCase();

      if (key === "?") { setShowModal((v) => !v); return; }

      if (pendingG.current) {
        clearTimeout(gTimer.current);
        pendingG.current = false;
        const path = SHORTCUT_MAP[key];
        if (path) navigate(path);
        return;
      }

      if (key === "g") {
        pendingG.current = true;
        gTimer.current = setTimeout(() => { pendingG.current = false; }, 1000);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  return (
    <>
      <KeyboardShortcutsModal open={showModal} onClose={() => setShowModal(false)} />
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 left-6 w-8 h-8 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full text-sm font-bold shadow z-40 hidden md:flex items-center justify-center"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
    </>
  );
}

const NAV_LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transactions", label: "Transactions" },
  { to: "/invoices", label: "Invoices" },
  { to: "/forecasting", label: "Forecast" },
  { to: "/chat", label: "Ask AI" },
  { to: "/notifications", label: "Notifications" },
  { to: "/settings", label: "Settings" },
];

function Layout({ children }) {
  const { user, logout, showWarning, countdown, handleStayLoggedIn } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItem = "px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors";
  const activeNav = "px-3 py-2 rounded-md text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30";
  const mobileItem = "block px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors";
  const mobileActive = "block px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30";

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
          <span className="text-xl font-bold text-blue-600 dark:text-blue-400">ClearFlow AI</span>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => isActive ? activeNav : navItem}>
                {l.label}
              </NavLink>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">{user?.full_name || user?.email}</span>
            <button onClick={logout} className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium">
              Logout
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 dark:border-gray-700 pb-2">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => isActive ? mobileActive : mobileItem}
                onClick={() => setMobileOpen(false)}
              >
                {l.label}
              </NavLink>
            ))}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">{user?.full_name || user?.email}</span>
              <button onClick={logout} className="text-sm text-red-500 hover:text-red-700 font-medium">Logout</button>
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 sm:py-8">
        {children}
      </main>

      <SessionTimeoutModal isOpen={showWarning} countdown={countdown} onStayIn={handleStayLoggedIn} onLogout={logout} />
      <OnboardingModal />
      <KeyboardShortcuts />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500 dark:text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
            <Route path="/forecasting" element={<ProtectedRoute><Forecasting /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
