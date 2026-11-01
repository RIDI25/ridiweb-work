import { WorkspaceProvider } from "@/components/providers/workspace-context";
import { workspaceAccess } from "@/lib/workspace-access";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { ClientProvider } from "@/components/providers/client-context";
import { Topbar, UserMenu } from "@/components/layout/topbar";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const access=await workspaceAccess(await createClient(),profile.id);
  return (
    <WorkspaceProvider restricted={access.restricted}><ClientProvider>
      <WorkspaceShell
        navigation={<Sidebar role={profile.role} footer={<UserMenu userName={profile.name} restricted={access.restricted} side />} />}
        mobileHeader={<Topbar userName={profile.name} role={profile.role} restricted={access.restricted} />}
      >
        {children}
      </WorkspaceShell>
    </ClientProvider></WorkspaceProvider>
  );
}
