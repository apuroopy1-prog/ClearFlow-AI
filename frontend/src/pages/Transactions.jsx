import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/api";

const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", INR: "₹", AUD: "A$", CAD: "C$" };
const CURRENCY_RATES = { USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.5, AUD: 1.53, CAD: 1.36 };

const CATEGORY_COLORS = {
  Revenue: "bg-green-100 text-green-700",
  Consulting: "bg-teal-100 text-teal-700",
  Payroll: "bg-orange-100 text-orange-700",
  Software: "bg-blue-100 text-blue-700",
  Travel: "bg-purple-100 text-purple-700",
  Meals: "bg-yellow-100 text-yellow-700",
  Utilities: "bg-gray-100 text-gray-700",
  "Office Supplies": "bg-pink-100 text-pink-700",
};

const SOURCE_TABS = [
  { key: "all", label: "All" },
  { key: "pdf", label: "Bank PDF" },
  { key: "csv", label: "CSV" },
];

function sourceOf(txn) {
  if (txn.transaction_id?.startsWith("pdf-")) return "pdf";
  if (txn.transaction_id?.startsWith("csv-")) return "csv";
  return "mock";
}

export default function Transactions() {
  const { user } = useAuth();
  const currencyCode = user?.currency || "USD";
  const currencySymbol = CURRENCY_SYMBOLS[currencyCode] || "$";
  const currencyRate = CURRENCY_RATES[currencyCode] || 1;
  const fmt = (v) => (Math.abs(v) * currencyRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [clearingMock, setClearingMock] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [autoTaxing, setAutoTaxing] = useState(false);
  const [editingTax, setEditingTax] = useState(null);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  const IRS_CATEGORIES = [
    "Advertising", "Car & Truck", "Commissions & Fees", "Contract Labor",
    "Insurance", "Interest", "Legal & Professional", "Meals (50%)",
    "Office Expenses", "Rent/Lease", "Repairs & Maintenance", "Supplies",
    "Taxes & Licenses", "Travel", "Utilities", "Wages", "Other Business",
    "Not Deductible",
  ];

  const autoCategorizeTax = async () => {
    setAutoTaxing(true);
    try {
      await api.post("/transactions/auto-tax");
      fetchTransactions();
      setUploadResult({ success: true, inserted: 0, skipped: 0, _clearMsg: "Tax categories auto-assigned by AI." });
    } catch {
      setUploadResult({ success: false, message: "Tax categorization failed" });
    } finally {
      setAutoTaxing(false);
    }
  };

  const updateTax = async (id, tax_category, is_deductible) => {
    try {
      await api.put(`/transactions/${id}/tax`, { tax_category, is_deductible });
      setTransactions((prev) => prev.map((t) => t.id === id ? { ...t, tax_category, is_deductible } : t));
    } catch { /* silent */ }
    setEditingTax(null);
  };

  const fetchTransactions = () => {
    api.get("/transactions")
      .then((res) => setTransactions(res.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTransactions(); }, []);

  const clearAll = async () => {
    if (!window.confirm(`Delete all ${transactions.length} transactions? This cannot be undone.`)) return;
    setClearingAll(true);
    try {
      const res = await api.delete("/transactions/clear-all");
      setTransactions([]);
      setActiveTab("all");
      setUploadResult({ success: true, inserted: 0, skipped: 0, _clearMsg: `Cleared ${res.data.deleted} transaction${res.data.deleted !== 1 ? "s" : ""}. Upload a new bank PDF to start fresh.` });
    } catch {
      setUploadResult({ success: false, message: "Failed to clear transactions" });
    } finally {
      setClearingAll(false);
    }
  };

  const clearMock = async () => {
    setClearingMock(true);
    try {
      const res = await api.delete("/transactions/clear-mock");
      setTransactions((prev) => prev.filter((t) => !t.transaction_id?.startsWith("mock-")));
      setUploadResult({ success: true, inserted: 0, skipped: 0, _clearMsg: `Removed ${res.data.deleted} mock transaction${res.data.deleted !== 1 ? "s" : ""}.` });
      if (activeTab === "mock") setActiveTab("all");
    } catch {
      setUploadResult({ success: false, message: "Failed to clear mock data" });
    } finally {
      setClearingMock(false);
    }
  };

  const downloadReport = async (format) => {
    try {
      const res = await api.get(`/reports/transactions?format=${format}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions.${format === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";

    setUploading(true);
    setUploadResult(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/transactions/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploadResult({ success: true, ...res.data });
      fetchTransactions();
      setActiveTab("csv");
    } catch (err) {
      setUploadResult({
        success: false,
        message: err.response?.data?.detail || "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  };

  const [pdfProgress, setPdfProgress] = useState("");

  const handlePdfChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = "";

    setUploadingPdf(true);
    setUploadResult(null);

    let totalInserted = 0;
    let totalSkipped = 0;
    let allErrors = [];
    const failedFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setPdfProgress(files.length > 1 ? `Parsing ${i + 1} of ${files.length}: ${file.name}` : "");
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await api.post("/transactions/upload-pdf", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        totalInserted += res.data.inserted || 0;
        totalSkipped += res.data.skipped || 0;
        allErrors = [...allErrors, ...(res.data.errors || [])];
      } catch (err) {
        failedFiles.push(`${file.name}: ${err.response?.data?.detail || "failed"}`);
      }
    }

    setPdfProgress("");

    if (failedFiles.length === files.length) {
      setUploadResult({ success: false, message: failedFiles.join("; ") });
    } else {
      setUploadResult({
        success: true,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: allErrors.slice(0, 10),
        _extraMsg: failedFiles.length ? ` (${failedFiles.length} file(s) failed)` : "",
      });
      fetchTransactions();
      setActiveTab("pdf");
    }

    setUploadingPdf(false);
  };

  const visibleTransactions = activeTab === "all"
    ? transactions
    : transactions.filter((t) => sourceOf(t) === activeTab);

  const hasMock = transactions.some((t) => t.transaction_id?.startsWith("mock-"));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bank Feed</h1>
          <p className="text-xs text-gray-400 mt-0.5">Upload a bank statement PDF or CSV — AI extracts your transactions automatically</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          <input ref={pdfInputRef} type="file" accept=".pdf" multiple onChange={handlePdfChange} className="hidden" />

          <button
            onClick={() => downloadReport("pdf")}
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Export PDF
          </button>
          <button
            onClick={() => downloadReport("excel")}
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Export Excel
          </button>
          <button
            onClick={() => fileInputRef.current.click()}
            disabled={uploading || uploadingPdf}
            className="bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {uploading ? "Uploading..." : "Upload CSV"}
          </button>
          <button
            onClick={autoCategorizeTax}
            disabled={autoTaxing || uploading || uploadingPdf}
            className="bg-white border border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 text-indigo-600 text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {autoTaxing ? "Categorizing..." : "🧾 Auto-Tax"}
          </button>
          {transactions.length > 0 && (
            <button
              onClick={clearAll}
              disabled={clearingAll || uploading || uploadingPdf}
              className="bg-white border border-red-200 hover:bg-red-50 disabled:opacity-50 text-red-500 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {clearingAll ? "Clearing..." : "Clear All"}
            </button>
          )}
          <button
            onClick={() => pdfInputRef.current.click()}
            disabled={uploading || uploadingPdf}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {uploadingPdf ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {pdfProgress || "Parsing PDF..."}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Upload Bank PDF
              </>
            )}
          </button>
        </div>
      </div>

      {uploadResult && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${uploadResult.success ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
          <span>
            {uploadResult._clearMsg
              ? uploadResult._clearMsg
              : uploadResult.success
              ? `Imported ${uploadResult.inserted} transaction${uploadResult.inserted !== 1 ? "s" : ""}${uploadResult.skipped ? `, ${uploadResult.skipped} duplicate${uploadResult.skipped !== 1 ? "s" : ""} skipped` : ""}.${uploadResult.errors?.length ? ` ${uploadResult.errors.length} row(s) had errors.` : ""}${uploadResult._extraMsg || ""}`
              : uploadResult.message}
          </span>
          <button onClick={() => setUploadResult(null)} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {/* Source filter tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {SOURCE_TABS.map((tab) => {
          const count = tab.key === "all" ? transactions.length : transactions.filter((t) => sourceOf(t) === tab.key).length;
          if (count === 0 && tab.key !== "all") return null;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{count}</span>
            </button>
          );
        })}
        {hasMock && (
          <button
            onClick={clearMock}
            disabled={clearingMock}
            className="ml-auto text-xs text-red-400 hover:text-red-600 disabled:opacity-50 flex items-center gap-1 pb-2"
          >
            {clearingMock ? "Clearing..." : "✕ Clear mock data"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 mt-20">Loading...</div>
      ) : visibleTransactions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          {activeTab === "all" ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-gray-700 font-semibold text-base">No transactions yet</p>
                <p className="text-gray-400 text-sm mt-1">Upload your bank statement PDF or CSV to get started</p>
              </div>
              <button
                onClick={() => pdfInputRef.current.click()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Bank PDF
              </button>
            </div>
          ) : (
            <p className="text-gray-400">{`No ${SOURCE_TABS.find((t) => t.key === activeTab)?.label} transactions.`}</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Description</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Tax (IRS)</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Account</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleTransactions.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{t.description}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${CATEGORY_COLORS[t.category] || "bg-gray-100 text-gray-600"}`}>
                      {t.category || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {editingTax === t.id ? (
                      <select
                        autoFocus
                        defaultValue={t.tax_category || ""}
                        onBlur={(e) => updateTax(t.id, e.target.value || null, e.target.value !== "Not Deductible" && e.target.value !== "")}
                        onChange={(e) => updateTax(t.id, e.target.value || null, e.target.value !== "Not Deductible" && e.target.value !== "")}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
                      >
                        <option value="">— none —</option>
                        {IRS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingTax(t.id)}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          t.tax_category
                            ? t.is_deductible
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                            : "bg-gray-50 text-gray-300 border border-dashed border-gray-200"
                        }`}
                      >
                        {t.tax_category || "+ Add"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{t.account}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${t.amount >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {t.amount >= 0 ? "+" : "-"}{currencySymbol}{fmt(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
