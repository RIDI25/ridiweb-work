import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MeetingsView } from "@/components/meetings/meetings-view";
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const profile = await requireProfile();
  const db = await createClient();
  const { data, error } = await db.from("clients").select("id,name").order("name");
  const { id } = await searchParams;
  return <MeetingsView userId={profile.id} clients={data || []} clientsError={!!error} initialId={id} />;
}
