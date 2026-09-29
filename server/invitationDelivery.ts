import { isEmailDeliveryConfigured, sendEmail } from "./emailDelivery";

type InvitationEmail = { email: string; role: "admin" | "member"; inviteUrl: string };

export async function validateInvitationDeliveryConfiguration() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!isEmailDeliveryConfigured()) throw new Error("Invitation delivery is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.");
  const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Resend credential validation failed (${r.status}).`);
  return true;
}

export async function sendTeamInvitation({ email, role, inviteUrl }: InvitationEmail) {
  return sendEmail({
    to: email,
    subject: "You are invited to the 45Creatives workspace",
    html: `<p>You have been invited as an <strong>${role}</strong> to the 45Creatives workspace.</p><p><a href="${inviteUrl}">Open the workspace</a></p>`,
  });
}
