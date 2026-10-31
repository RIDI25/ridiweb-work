import { requireProfile } from "@/lib/auth";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const profile = await requireProfile();
  return <SettingsView role={profile.role} aiConnected={{ fable: !!process.env.ANTHROPIC_API_KEY, astra: !!process.env.OPENAI_API_KEY }} />;
}
