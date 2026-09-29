import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { LoaderCircle, ShieldCheck, UserRound } from "lucide-react";

export function buildProfileUpdateInput(name: string, bio: string) {
  return { name: name.trim(), bio: bio.trim() };
}

export function profileMutationFeedback(kind: "success" | "error") {
  return kind === "success" ? "Profile updated" : "Unable to update your profile. Please try again.";
}

export function notifyProfileMutation(toastApi: { success: (message: string) => unknown; error: (message: string) => unknown }, kind: "success" | "error") {
  toastApi[kind](profileMutationFeedback(kind));
}

export function shouldShowProfileSkeleton(userPresent: boolean, loading: boolean) {
  return userPresent && loading;
}

export function formatLastSignedIn(value: Date | string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

export default function DashboardProfileCard() {
  const { user } = useAuth();
  const profile = trpc.auth.profile.useQuery(undefined, { enabled: Boolean(user), staleTime: 30_000 });
  const data = profile.data;

  return (
    <section className="panel dashboard-profile-card" aria-labelledby="dashboard-profile-title">
      <div className="dashboard-profile-heading">
        <div className="dashboard-profile-icon" aria-hidden="true"><UserRound /></div>
        <div><span className="eyebrow">Workspace identity</span><h2 id="dashboard-profile-title">Your profile</h2></div><button className="profile-edit-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("4s-open-profile"))} disabled={!user}>Edit profile</button>
        {profile.isFetching && data ? <LoaderCircle className="dashboard-profile-loading" aria-label="Refreshing profile" /> : null}
      </div>
      {!user ? <p className="dashboard-profile-message">Sign in to sync workspace data and view your profile details.</p> : shouldShowProfileSkeleton(Boolean(user), profile.isLoading) ? <div className="dashboard-profile-skeleton" aria-label="Loading profile details"><span /><span /><span /><span /></div> : profile.isError ? <p className="dashboard-profile-message">Profile details could not be loaded. Please try again shortly.</p> : (
        <div className="dashboard-profile-details">
          <div><span>Name</span><strong>{data?.displayName || "Workspace user"}</strong></div>
          <div><span>Email</span><strong>{data?.email || "Not available"}</strong></div>
          <div><span>Role</span><strong><ShieldCheck aria-hidden="true" />{data?.role === "admin" ? "Administrator" : "Team member"}</strong></div>
          <div><span>Last signed in</span><strong>{formatLastSignedIn(data?.lastSignedIn)}</strong></div>{data?.bio ? <div className="dashboard-profile-bio"><span>Bio</span><strong>{data.bio}</strong></div> : null}
        </div>
      )}
    </section>
  );
}
