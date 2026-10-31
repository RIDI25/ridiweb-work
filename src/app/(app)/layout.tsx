import { requireProfile } from "@/lib/auth";
import { ClientProvider } from "@/components/providers/client-context";
import { Topbar, UserMenu } from "@/components/layout/topbar";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <ClientProvider>
      <WorkspaceShell
        navigation={<Sidebar role={profile.role} footer={<UserMenu userName={profile.name} side />} />}
        mobileHeader={<Topbar userName={profile.name} role={profile.role} />}
      >
        {children}
      </WorkspaceShell>
    </ClientProvider>
  );
}
