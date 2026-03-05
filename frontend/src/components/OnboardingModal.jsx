import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const STEPS = [
  {
    icon: "💳",
    title: "Sync your transactions",
    description: "Import your bank feed or upload a CSV file to get started.",
    path: "/transactions",
    key: "onboard_txn",
  },
  {
    icon: "📄",
    title: "Upload an invoice",
    description: "Scan or upload invoices — OCR extracts key data automatically.",
    path: "/invoices",
    key: "onboard_inv",
  },
  {
    icon: "🤖",
    title: "Ask the AI a question",
    description: "Chat with ClearFlow AI about your finances anytime.",
    path: "/chat",
    key: "onboard_chat",
  },
];

export default function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const onboarded = localStorage.getItem("onboarded");
    if (!onboarded) setOpen(true);

    const c = {};
    STEPS.forEach((s) => { c[s.key] = !!localStorage.getItem(s.key); });
    setCompleted(c);
  }, []);

  const dismiss = () => {
    localStorage.setItem("onboarded", "true");
    setOpen(false);
  };

  const goTo = (path, key) => {
    localStorage.setItem(key, "true");
    setCompleted((prev) => ({ ...prev, [key]: true }));
    dismiss();
    navigate(path);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center text-lg font-bold z-40 transition-colors"
        title="Getting started guide"
      >
        ?
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Welcome to ClearFlow AI</h2>
          <p className="text-gray-500 text-sm mt-1">Complete these 3 steps to get the most out of the app.</p>
        </div>

        <div className="space-y-3 mb-8">
          {STEPS.map((step) => (
            <button
              key={step.key}
              onClick={() => goTo(step.path, step.key)}
              className="w-full flex items-start gap-4 p-4 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left"
            >
              <span className="text-2xl mt-0.5">{step.icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">{step.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>
              </div>
              {completed[step.key] ? (
                <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-300 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={dismiss}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
