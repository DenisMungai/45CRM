import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, LockKeyhole, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const logo = "/assets/45creatives-logo.png";

/** Landing page for `/invite/<token>`: new people set a name and password, existing users confirm theirs. */
export default function InviteAccept() {
  const token = useMemo(() => decodeURIComponent(window.location.pathname.match(/\/invite\/([^/]+)/)?.[1] || ""), []);
  const invitation = trpc.auth.invitation.useQuery({ token }, { enabled: token.length >= 20, retry: false });
  const accept = trpc.auth.acceptInvitation.useMutation({ onSuccess: () => { toast.success("Welcome to the workspace"); window.location.href = "/"; }, onError: (error) => toast.error(error.message) });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const data = invitation.data;
  const mismatch = Boolean(data && !data.hasAccount && confirm && password !== confirm);
  const submit = (event: FormEvent) => { event.preventDefault(); if (mismatch) return; accept.mutate({ token, name: data?.hasAccount ? undefined : name.trim(), password }); };
  const shell = (children: React.ReactNode) => <main className="min-h-screen flex items-center justify-center bg-background p-6"><div className="w-full max-w-md"><div className="panel p-8"><div className="flex items-center gap-3 mb-8"><div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center overflow-hidden"><img src={logo} alt="45Creatives" className="h-8 w-8 object-contain" /></div><div><p className="eyebrow">45CREATIVES</p><h1 className="text-2xl font-semibold">Operations</h1></div></div>{children}</div></div></main>;
  if (token.length < 20) return shell(<div className="invite-state"><TriangleAlert /><h2 className="text-xl font-semibold mb-2">Invitation link incomplete</h2><p className="panel-subtle">Open the full link from your invitation email, or ask the workspace admin to send it again.</p></div>);
  if (invitation.isLoading) return shell(<p className="panel-subtle">Checking your invitation…</p>);
  if (invitation.isError || !data) return shell(<div className="invite-state"><TriangleAlert /><h2 className="text-xl font-semibold mb-2">Invitation unavailable</h2><p className="panel-subtle mb-6">{invitation.error?.message || "This invitation can't be used."}</p><a className="heading-action w-full justify-center" href="/login">Go to sign in<ArrowRight className="h-4 w-4" /></a></div>);
  return shell(<>
    <h2 className="text-xl font-semibold mb-2">Join {data.workspaceName}</h2>
    <p className="panel-subtle mb-7">You've been invited as {data.role === "admin" ? "an administrator" : "a team member"} with <strong>{data.email}</strong>. {data.hasAccount ? "Enter your existing password to add this workspace to your account." : "Set your name and a password to create your account."}</p>
    <form onSubmit={submit} className="space-y-4">
      {!data.hasAccount ? <label className="block"><span className="text-sm">Your name</span><div className="auth-field mt-2"><UserRound /><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Full name" autoComplete="name" /></div></label> : null}
      <label className="block"><span className="text-sm">{data.hasAccount ? "Password" : "Choose a password"}</span><div className="auth-field mt-2"><LockKeyhole /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete={data.hasAccount ? "current-password" : "new-password"} /></div></label>
      {!data.hasAccount ? <label className="block"><span className="text-sm">Confirm password</span><div className="auth-field mt-2"><LockKeyhole /><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} placeholder="Repeat the password" autoComplete="new-password" /></div>{mismatch ? <span className="panel-subtle" role="alert">The passwords don't match.</span> : null}</label> : null}
      <button className="heading-action w-full justify-center" disabled={accept.isPending || mismatch}>{accept.isPending ? "Joining…" : "Accept invitation"}<ArrowRight className="h-4 w-4" /></button>
    </form>
  </>);
}
