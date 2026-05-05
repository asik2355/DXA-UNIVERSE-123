/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { 
  Send, 
  ShieldCheck, 
  Activity, 
  History, 
  MessageSquare, 
  AlertCircle,
  RefreshCw,
  ExternalLink,
  User,
  Key,
  Phone,
  Layout,
  Copy,
  CheckCircle2,
  Download,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";

interface ForwardLog {
  id: number;
  from: string;
  text: string;
  time: string;
}

interface BotStatus {
  botStatus: string;
  userStatus: string;
  sourceGroup: string;
  targetGroups: string[];
  logs: ForwardLog[];
  isForwardingEnabled: boolean;
  isAdmin: boolean;
  customMenuButtons: { label: string, url: string }[];
}

export default function App() {
  const [data, setData] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'dashboard' | 'admin'>('dashboard');
  
  // Admin State
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [editingButtons, setEditingButtons] = useState<{label: string, url: string}[]>([]);
  const [savingMenu, setSavingMenu] = useState(false);
  
  // Login State
  const [showLogin, setShowLogin] = useState(false);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+263786973465');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [session, setSession] = useState<{
    session: string;
    phone?: string;
    apiId?: number;
    apiHash?: string;
  } | null>(null);
  const [copying, setCopying] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("Failed to fetch bot status");
      const result = await response.json();
      setData(result);
      if (editingButtons.length === 0 && result.customMenuButtons) {
        setEditingButtons(result.customMenuButtons);
      }
      setError(null);
    } catch (err) {
      setError("Unable to connect to the bot server.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    try {
      await fetch("/api/admin/toggle", { method: "POST" });
      fetchStatus();
    } catch (e) { alert("Failed to toggle system"); }
  };

  const handleBroadcast = async () => {
    if (!broadcastMessage) return;
    setBroadcasting(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: broadcastMessage }),
      });
      if (res.ok) {
        setBroadcastMessage("");
        alert("Broadcast sent!");
      }
    } catch (e) { alert("Broadcast failed"); }
    setBroadcasting(false);
  };

  const handleSaveMenu = async () => {
    setSavingMenu(true);
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buttons: editingButtons }),
      });
      if (res.ok) {
        alert("Menu updated successfully!");
        fetchStatus();
      }
    } catch (e) { alert("Failed to update menu"); }
    setSavingMenu(false);
  };

  const addMenuButton = () => {
    setEditingButtons([...editingButtons, { label: "New Button", url: "https://" }]);
  };

  const removeMenuButton = (index: number) => {
    setEditingButtons(editingButtons.filter((_, i) => i !== index));
  };

  const updateMenuButton = (index: number, field: 'label' | 'url', value: string) => {
    const newButtons = [...editingButtons];
    newButtons[index] = { ...newButtons[index], [field]: value };
    setEditingButtons(newButtons);
  };

  const handleStartLogin = async () => {
    setLoginLoading(true);
    try {
      const res = await fetch("/api/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to send code");
        } else {
          throw new Error(`Server error (${res.status}). Please check server logs.`);
        }
      }
      setStep('code');
    } catch (err: any) {
      alert(err.message || String(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleVerifyLogin = async () => {
    setLoginLoading(true);
    try {
      const res = await fetch("/api/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, password }),
      });
      
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Verification failed");
        } else {
          throw new Error(`Server error (${res.status}). Please check server logs.`);
        }
      }
      setShowLogin(false);
      fetchStatus();
    } catch (err: any) {
      alert(err.message || String(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleCopySession = async () => {
    try {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error("Failed to fetch session");
      const result = await res.json();
      
      await navigator.clipboard.writeText(result.session);
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    } catch (err) {
      alert("Failed to copy session string");
    }
  };

  const handleViewSession = async () => {
    try {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error("Failed to fetch session");
      const result = await res.json();
      setSession(result);
      setShowSessionModal(true);
    } catch (err) {
      alert("Failed to fetch session details");
    }
  };

  const handleDownloadConfig = () => {
    if (!session) return;
    const content = `# Telegram Relay Configuration
# Generated on: ${new Date().toLocaleString()}

API_ID = ${session.apiId || "YOUR_API_ID"}
API_HASH = "${session.apiHash || "YOUR_API_HASH"}"
PHONE = "${session.phone || "YOUR_PHONE"}"
SESSION_STRING = "${session.session}"

# Usage Example (Python Telethon):
# client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${session.phone || "config"}.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-[#E0E0E0] font-sans selection:bg-[#3B82F6]/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Send className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Telegram Forwarder</h1>
          </div>
          
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-1">
              <button 
                onClick={() => setView('dashboard')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  view === 'dashboard' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                )}
              >
                Dashboard
              </button>
              <button 
                onClick={() => setView('admin')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                  view === 'admin' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                )}
              >
                <Layout className="w-4 h-4" />
                Admin Panel
              </button>
            </nav>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowLogin(true)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 transition-all",
                data?.userStatus === "Active" 
                  ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_0_15px_rgba(37,99,235,0.4)]"
              )}
            >
              <User className="w-3.5 h-3.5" />
              {data?.userStatus === "Active" ? "Account Linked" : "Connect User Account"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          {view === 'dashboard' ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Login Modal Overlay */}
              <AnimatePresence>
                {showLogin && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
                  >
                    <motion.div 
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      className="bg-[#1A1A1A] border border-white/10 w-full max-w-md rounded-3xl p-8 shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-bold">Connect Account</h2>
                        <button onClick={() => setShowLogin(false)} className="text-white/40 hover:text-white">✕</button>
                      </div>

                      <div className="space-y-6">
                        {step === 'phone' ? (
                          <>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-white/40 uppercase tracking-widest">Phone Number</label>
                              <div className="relative">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                <input 
                                  type="text" 
                                  placeholder="+1234567890" 
                                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                  value={phone}
                                  onChange={(e) => setPhone(e.target.value)}
                                />
                              </div>
                            </div>
                            <button 
                              onClick={handleStartLogin}
                              disabled={loginLoading}
                              className="w-full bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                            >
                              {loginLoading ? "Sending Code..." : "Send Verification Code"}
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-white/40 uppercase tracking-widest">Verification Code</label>
                              <div className="relative">
                                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                                <input 
                                  type="text" 
                                  placeholder="12345" 
                                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                  value={code}
                                  onChange={(e) => setCode(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-white/40 uppercase tracking-widest text-[10px]">2FA Password (If enabled)</label>
                              <input 
                                type="password" 
                                placeholder="Optional" 
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                              />
                            </div>
                            <div className="flex gap-3">
                              <button onClick={() => setStep('phone')} className="flex-1 bg-white/5 border border-white/10 py-3 rounded-xl font-bold hover:bg-white/10 transition-all">Back</button>
                              <button 
                                onClick={handleVerifyLogin}
                                disabled={loginLoading}
                                className="flex-[2] bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] disabled:opacity-50"
                              >
                                {loginLoading ? "Verifying..." : "Connect Now"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                      <Activity className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Status</span>
                  </div>
                  <h3 className="text-white/60 text-xs font-medium mb-1">Bot</h3>
                  <p className="text-xl font-bold">{data?.botStatus || "Offline"}</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
                      <User className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">User</span>
                  </div>
                  <h3 className="text-white/60 text-xs font-medium mb-1">Listener</h3>
                  <p className="text-xl font-bold text-green-400">{data?.userStatus || "Logged Out"}</p>
                  
                  {data?.userStatus === "Active" && (
                    <div className="mt-4 flex gap-2">
                       <button 
                        onClick={handleCopySession}
                        className="flex-1 bg-white/5 border border-white/10 py-1.5 rounded-lg text-[10px] font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-1.5"
                      >
                        {copying ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        {copying ? "Copied" : "Copy Session"}
                      </button>
                      <button 
                        onClick={handleViewSession}
                        className="flex-1 bg-blue-600/10 border border-blue-500/20 py-1.5 rounded-lg text-[10px] font-bold text-blue-400 hover:bg-blue-600/20 transition-all flex items-center justify-center gap-1.5"
                      >
                        <Key className="w-3 h-3" />
                        View
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Pipe</span>
                  </div>
                  <h3 className="text-white/60 text-xs font-medium mb-1">Source</h3>
                  <p className="text-lg font-bold font-mono overflow-hidden text-ellipsis">{data?.sourceGroup?.substring(0, 10)}...</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
                      <History className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Volume</span>
                  </div>
                  <h3 className="text-white/60 text-xs font-medium mb-1">Processed</h3>
                  <p className="text-xl font-bold">{data?.logs.length || 0}</p>
                </div>
              </div>

              {/* Console / Logs Section */}
              
              {/* Session Modal */}
              <AnimatePresence>
                {showSessionModal && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
                  >
                    <motion.div 
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      className="bg-[#1A1A1A] border border-white/10 w-full max-w-2xl rounded-3xl p-8 shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <h2 className="text-2xl font-bold italic tracking-tight">Telegram Session String</h2>
                          <p className="text-white/40 text-xs mt-1">This is your authenticated MTProto session. Keep it secret.</p>
                        </div>
                        <button onClick={() => setShowSessionModal(false)} className="text-white/40 hover:text-white">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-black/40 border border-white/5 rounded-2xl p-4">
                            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Phone Number</p>
                            <p className="text-sm font-mono text-blue-400">{session?.phone || "N/A"}</p>
                          </div>
                          <div className="bg-black/40 border border-white/5 rounded-2xl p-4">
                            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">API ID</p>
                            <p className="text-sm font-mono text-blue-400">{session?.apiId || "N/A"}</p>
                          </div>
                          <div className="bg-black/40 border border-white/5 rounded-2xl p-4 md:col-span-2">
                            <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">API Hash</p>
                            <p className="text-sm font-mono text-blue-400">{session?.apiHash || "N/A"}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">Authenticated Session String</p>
                          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 font-mono text-[10px] break-all leading-relaxed max-h-[250px] overflow-y-auto custom-scrollbar">
                            {session?.session}
                          </div>
                        </div>
                      </div>

                      <div className="mt-8 flex flex-col sm:flex-row gap-3">
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(session?.session || "");
                            setCopying(true);
                            setTimeout(() => setCopying(false), 2000);
                          }}
                          className="flex-[2] bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                        >
                          {copying ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copying ? "Copied" : "Copy Session String"}
                        </button>
                        <button 
                          onClick={handleDownloadConfig}
                          className="flex-1 bg-white/5 border border-white/10 py-3 rounded-xl font-bold hover:bg-white/10 transition-all text-sm flex items-center justify-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Download Config
                        </button>
                        <button onClick={() => setShowSessionModal(false)} className="flex-1 bg-white/5 border border-white/10 py-3 rounded-xl font-bold hover:bg-white/10 transition-all text-sm px-4">Close</button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <RefreshCw className={cn("w-4 h-4 text-white/40", loading && "animate-spin")} />
                    <h2 className="text-sm font-medium uppercase tracking-wider text-white/60">Live Clean Forward Log</h2>
                  </div>
                  {data?.userStatus !== "Active" && (
                    <div className="flex items-center gap-2 text-amber-400 text-[10px] animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      <span>USER ACCOUNT NOT CONNECTED</span>
                    </div>
                  )}
                </div>
                
                <div className="p-2 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {error ? (
                    <div className="p-10 flex flex-col items-center justify-center text-center">
                      <AlertCircle className="w-12 h-12 text-red-500 mb-4 opacity-50" />
                      <p className="text-white/60">{error}</p>
                      <button 
                        onClick={() => fetchStatus()}
                        className="mt-4 px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-all border border-white/10"
                      >
                        Retry Connection
                      </button>
                    </div>
                  ) : data?.logs.length === 0 ? (
                    <div className="p-20 flex flex-col items-center justify-center text-center">
                      <div className="relative mb-6">
                        <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full" />
                        <Send className="w-12 h-12 text-blue-500 relative animate-pulse" />
                      </div>
                      <h3 className="text-xl font-medium mb-2">Awaiting Messages</h3>
                      <p className="text-white/40 max-w-xs">
                        Bot is watching group <span className="text-blue-400 font-mono">{data?.sourceGroup}</span> and forwarding to <span className="text-green-400 font-mono">{data?.targetGroups?.length || 0}</span> groups.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      <AnimatePresence initial={false}>
                        {data?.logs.map((log) => (
                          <motion.div
                            key={log.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="group flex items-start gap-4 p-4 hover:bg-white/[0.02] transition-colors"
                          >
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0 text-blue-400 text-xs font-bold border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                              {log.from.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-grow min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-bold text-white/90 truncate mr-2">
                                  @{log.from}
                                </span>
                                <span className="text-[10px] font-mono text-white/30 whitespace-nowrap bg-white/5 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                                  {log.time}
                                </span>
                              </div>
                              <p className="text-sm text-white/60 break-words leading-relaxed">
                                {log.text}
                              </p>
                              <div className="mt-2 flex items-center gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded-sm font-mono uppercase">Buttons Removed</span>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              {/* Admin Panel / Menu Builder Content */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent italic tracking-tight">Admin Panel</h2>
                  <p className="text-white/40 text-sm mt-1">Configure bot features and menu options</p>
                </div>
                <div className="p-3 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                  <Layout className="w-6 h-6 text-blue-400" />
                </div>
              </div>

              {/* Admin Secret Tools */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-12 bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 blur-3xl rounded-full -mr-20 -mt-20 group-hover:bg-blue-600/10 transition-colors" />
                  
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-8">
                      <ShieldCheck className="w-6 h-6 text-blue-400" />
                      <h3 className="text-xl font-bold">System Configuration</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                          <div>
                            <p className="text-sm font-semibold">Automatic Forwarding</p>
                            <p className="text-xs text-white/40 mt-1">Enable or disable global message relay</p>
                          </div>
                          <button 
                            onClick={handleToggle}
                            className={cn(
                              "w-14 h-7 rounded-full transition-all relative flex items-center px-1",
                              data?.isForwardingEnabled ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "bg-white/10"
                            )}
                          >
                            <div className={cn(
                              "w-5 h-5 bg-white rounded-full transition-all shadow-lg",
                              data?.isForwardingEnabled ? "translate-x-7" : "translate-x-0"
                            )} />
                          </button>
                        </div>

                        <div className="p-6 bg-black/40 rounded-2xl border border-white/5">
                          <div className="flex items-center gap-2 mb-4">
                            <MessageSquare className="w-4 h-4 text-white/40" />
                            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">Broadcaster</h4>
                          </div>
                          <div className="space-y-3">
                            <textarea 
                              value={broadcastMessage}
                              onChange={(e) => setBroadcastMessage(e.target.value)}
                              placeholder="Message to broadcast..."
                              className="w-full h-24 bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm resize-none"
                            />
                            <button 
                              onClick={handleBroadcast}
                              disabled={broadcasting || !broadcastMessage}
                              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                            >
                              {broadcasting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              {broadcasting ? "Broadcasting..." : "Run Global Broadcast"}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                          <h4 className="text-sm font-bold mb-4 flex items-center justify-between">
                            Menu Builder
                            <button 
                              onClick={addMenuButton}
                              className="text-[10px] px-2 py-1 bg-blue-600 rounded hover:bg-blue-700 transition-colors"
                            >
                              + Add Button
                            </button>
                          </h4>
                          
                          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            {editingButtons.length === 0 ? (
                              <div className="flex flex-col items-center justify-center py-8 text-center bg-black/20 rounded-xl border border-dashed border-white/10">
                                <Layout className="w-8 h-8 text-white/10 mb-2" />
                                <p className="text-sm text-white/40">No custom buttons added yet</p>
                              </div>
                            ) : (
                              editingButtons.map((btn, idx) => (
                                <div key={idx} className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-2">
                                  <div className="flex gap-2">
                                    <input 
                                      value={btn.label}
                                      onChange={(e) => updateMenuButton(idx, 'label', e.target.value)}
                                      placeholder="Button Label"
                                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-500"
                                    />
                                    <button 
                                      onClick={() => removeMenuButton(idx)}
                                      className="text-red-400 hover:text-red-300 px-1"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <input 
                                    value={btn.url}
                                    onChange={(e) => updateMenuButton(idx, 'url', e.target.value)}
                                    placeholder="URL (https://...)"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-mono outline-none focus:border-blue-500"
                                  />
                                </div>
                              ))
                            )}
                          </div>

                          {editingButtons.length > 0 && (
                            <button 
                              onClick={handleSaveMenu}
                              disabled={savingMenu}
                              className="w-full mt-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                            >
                              {savingMenu ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                              Save Live Menu
                            </button>
                          )}
                        </div>
                        
                        <div className="p-6 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl">
                          <div className="flex items-center gap-2 mb-2 text-yellow-500">
                            <AlertCircle className="w-4 h-4" />
                            <h4 className="text-xs font-bold uppercase tracking-widest">Safety Warning</h4>
                          </div>
                          <p className="text-[11px] text-white/40 leading-relaxed italic">
                            Running a broadcast or disabling the system affects all connected groups immediately. Use with caution.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 pb-12">
          <div className="flex items-center gap-2 text-white/30 text-xs">
            <ShieldCheck className="w-4 h-4" />
            <span>Dual Protocol Link (MTProto + BotAPI)</span>
            <span className="mx-2 opacity-50">•</span>
            <span>Stripping Reply Markups</span>
          </div>
          {view === 'dashboard' && (
            <div className="flex gap-4">
              <a 
                href="https://my.telegram.org" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-white/40 hover:text-white/80 transition-colors flex items-center gap-1.5 text-xs font-medium"
              >
                Get API ID/Hash <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
