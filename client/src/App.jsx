import { useState } from "react";
import MessageThread from "./components/MessageThread.jsx";
import ChatInput from "./components/ChatInput.jsx";
import { sendChat, getTravelerId, ApiError } from "./api.js";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);

  async function handleSend(text) {
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", pending: true }]);
    setBusy(true);

    try {
      const data = await sendChat(text, getTravelerId());
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", data };
        return next;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong reaching Stayora.";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", error: message };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-stayora-navy px-6 py-4">
        <h1 className="text-lg font-semibold text-white">Stayora</h1>
        <p className="text-xs text-slate-300">A premium agentic hotel booking assistant</p>
      </header>

      <MessageThread messages={messages} />
      <ChatInput onSend={handleSend} disabled={busy} />
    </div>
  );
}
