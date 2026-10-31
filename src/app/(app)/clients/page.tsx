import { ClientsIndex } from "@/components/clients/clients-index";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceProgress } from "@/lib/workspace-data";

export default async function ClientsPage() {
  const data = await loadWorkspaceProgress(await createClient());
  return <ClientsIndex progress={data.clients} warnings={data.warnings} />;
}
