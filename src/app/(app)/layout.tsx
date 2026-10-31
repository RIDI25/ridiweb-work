import { requireProfile } from "@/lib/auth";
import { ClientProvider } from "@/components/providers/client-context";
import { Topbar } from "@/components/layout/topbar";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <ClientProvider>
      <WorkspaceShell header={<Topbar userName={profile.name} role={profile.role} />}>
        {children}
      </WorkspaceShell>
    </ClientProvider>
  );
}
