import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import api from "../services/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", INR: "₹", AUD: "A$", CAD: "C$" };
const CURRENCY_RATES = { USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.5, AUD: 1.53, CAD: 1.36 };

function KpiCard({ label, value, color, prefix = "" }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6`}>
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>
        {prefix}{value}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const currencyCode = user?.currency || "USD";
  const currencySymbol = CURRENCY_SYMBOLS[currencyCode] || "$";
  const currencyRate = CURRENCY_RATES[currencyCode] || 1;
  const fmt = (v) => (v * currencyRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [anomalies, setAnomalies] = useState(null);
  const [dismissedAnomalies, setDismissedAnomalies] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dismissedAnomalies") || "[]"); } catch { return []; }
  });
  const [budgets, setBudgets] = useState([]);
  const [taxSummary, setTaxSummary] = useState(null);

  useEffect(() => {
    api.get("/transactions/summary")
      .then((res) => setSummary(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));

    api.get("/chat/insights")
      .then((res) => setInsights(res.data.insights))
      .catch(() => setInsights(null))
      .finally(() => setInsightsLoading(false));

    api.get("/transactions/anomalies")
      .then((res) => setAnomalies(res.data.anomalies))
      .catch(() => setAnomalies([]));

    api.get("/budgets")
      .then((res) => setBudgets(res.data))
      .catch(() => {});

    api.get(`/transactions/tax-summary?year=${new Date().getFullYear()}`)
      .then((res) => setTaxSummary(res.data))
      .catch(() => {});
  }, []);

  const dismissAnomaly = (idx) => {
    const updated = [...dismissedAnomalies, idx];
    setDismissedAnomalies(updated);
    localStorage.setItem("dismissedAnomalies", JSON.stringify(updated));
  };

  const downloadSummary = async (format) => {
    try {
      const res = await api.get(`/reports/summary?format=${format}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `summary.${format === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading dashboard...</div>;

  const monthly = summary?.monthly_breakdown || {};
  const labels = Object.keys(monthly);
  const values = Object.values(monthly);

  const barData = {
    labels,
    datasets: [{
      label: "Net Cash Flow ($)",
      data: values,
      backgroundColor: values.map((v) => v >= 0 ? "rgba(59, 130, 246, 0.7)" : "rgba(239, 68, 68, 0.7)"),
      borderRadius: 6,
    }],
  };

  const lineData = {
    labels,
    datasets: [{
      label: "Cumulative Net ($)",
      data: values.reduce((acc, v, i) => {
        acc.push((acc[i - 1] || 0) + v);
        return acc;
      }, []),
      borderColor: "#3b82f6",
      backgroundColor: "rgba(59,130,246,0.1)",
      fill: true,
      tension: 0.4,
      pointRadius: 4,
    }],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { position: "top" } },
    scales: { y: { beginAtZero: false } },
  };

  const hasTransactions = summary && (summary.total_income > 0 || summary.total_expenses > 0 || summary.transaction_count > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={() => downloadSummary("pdf")}
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Export PDF
          </button>
          <button
            onClick={() => downloadSummary("excel")}
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Export Excel
          </button>
          <button
            onClick={() => api.post("/reports/send-now").then(() => alert("Report emailed!"))}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Email Report
          </button>
        </div>
      </div>

      {/* Upload banner — shown when no transactions */}
      {!loading && !hasTransactions && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-indigo-800 font-semibold text-sm">No transactions yet</p>
            <p className="text-indigo-600 text-xs mt-0.5">Upload your bank statement PDF to populate your dashboard with real data.</p>
          </div>
          <Link
            to="/transactions"
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Bank PDF
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Revenue" value={fmt(summary?.total_income ?? 0)} color="text-green-600" prefix={currencySymbol} />
        <KpiCard label="Total Expenses" value={fmt(summary?.total_expenses ?? 0)} color="text-red-500" prefix={currencySymbol} />
        <KpiCard label="Net Income" value={fmt(summary?.net ?? 0)} color={summary?.net >= 0 ? "text-blue-600" : "text-red-500"} prefix={currencySymbol} />
        <KpiCard label="Transactions" value={summary?.transaction_count ?? 0} color="text-purple-600" prefix="" />
      </div>

      {/* AI Insights */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">✨</span>
          <h2 className="text-base font-semibold text-gray-700">AI Insights</h2>
        </div>
        {insightsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${70 + i * 8}%` }} />
            ))}
          </div>
        ) : insights && insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((insight, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-600">
                <span className="text-blue-500 mt-0.5">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Upload a bank statement PDF to get AI-powered insights.</p>
        )}
      </div>

      {/* Anomaly Alerts */}
      {anomalies && anomalies.length > 0 && (() => {
        const visible = anomalies.filter((_, i) => !dismissedAnomalies.includes(i));
        if (visible.length === 0) return null;
        return (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">⚠️</span>
              <h2 className="text-base font-semibold text-gray-700">Anomaly Alerts</h2>
              <span className="ml-auto text-xs text-gray-400">{visible.length} detected</span>
            </div>
            <div className="space-y-2">
              {anomalies.map((a, i) => {
                if (dismissedAnomalies.includes(i)) return null;
                const severityClass = a.severity === "high"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : a.severity === "medium"
                  ? "bg-yellow-50 border-yellow-200 text-yellow-700"
                  : "bg-gray-50 border-gray-200 text-gray-600";
                return (
                  <div key={i} className={`flex items-start justify-between gap-3 border rounded-lg px-4 py-3 text-sm ${severityClass}`}>
                    <div>
                      <span className="font-semibold capitalize">{a.type?.replace(/_/g, " ")}: </span>
                      {a.description}
                    </div>
                    <button onClick={() => dismissAnomaly(i)} className="shrink-0 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Budget Progress */}
      {budgets.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Budget Goals — This Month</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {budgets.map((g) => {
              const pct = Math.min((g.spent / g.monthly_limit) * 100, 100);
              const over = g.spent > g.monthly_limit;
              return (
                <div key={g.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{g.category}</span>
                    <span className={over ? "text-red-500 font-semibold" : "text-gray-500"}>
                      ${g.spent.toFixed(0)} / ${g.monthly_limit.toFixed(0)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${over ? "bg-red-500" : pct > 80 ? "bg-yellow-400" : "bg-blue-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tax Summary */}
      {taxSummary && taxSummary.total_deductible > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🧾</span>
              <h2 className="text-base font-semibold text-gray-700">Tax Deductibles — {new Date().getFullYear()}</h2>
            </div>
            <a href="/tax" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">View full report →</a>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
              <p className="text-xs text-green-600 font-medium">Total Deductible</p>
              <p className="text-xl font-bold text-green-700">{currencySymbol}{fmt(taxSummary.total_deductible)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(taxSummary.by_category || {}).slice(0, 6).map(([cat, amt]) => (
              <div key={cat} className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 truncate">{cat}</p>
                <p className="text-sm font-semibold text-gray-700">{currencySymbol}{fmt(amt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Monthly Cash Flow</h2>
          {labels.length > 0 ? <Bar data={barData} options={chartOptions} /> : (
            <div className="text-center text-gray-400 py-12">No data yet — upload a bank statement PDF first</div>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Cumulative Net</h2>
          {labels.length > 0 ? <Line data={lineData} options={chartOptions} /> : (
            <div className="text-center text-gray-400 py-12">No data yet — upload a bank statement PDF first</div>
          )}
        </div>
      </div>
    </div>
  );
}
