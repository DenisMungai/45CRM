import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";

const logo = "/assets/45creatives-logo.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setLoading(true); try { const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error || "Sign in failed"); window.location.href = "/"; } catch (e) { toast.error(e instanceof Error ? e.message : "Sign in failed"); } finally { setLoading(false); } }
  return <main className="min-h-screen flex items-center justify-center bg-background p-6"><div className="w-full max-w-md"><div className="panel p-8"><div className="flex items-center gap-3 mb-8"><div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center overflow-hidden"><img src={logo} alt="45Creatives" className="h-8 w-8 object-contain" /></div><div><p className="eyebrow">45CREATIVES</p><h1 className="text-2xl font-semibold">Operations</h1></div></div><h2 className="text-xl font-semibold mb-2">Welcome back</h2><p className="panel-subtle mb-7">Sign in to your private workspace.</p><form onSubmit={submit} className="space-y-4"><label className="block"><span className="text-sm">Email</span><div className="auth-field mt-2"><Mail /><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com"/></div></label><label className="block"><span className="text-sm">Password</span><div className="auth-field mt-2"><LockKeyhole /><input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••"/></div></label><button className="heading-action w-full justify-center" disabled={loading}>{loading ? "Signing in…" : "Sign in"}<ArrowRight className="h-4 w-4"/></button></form></div></div></main>;
}
