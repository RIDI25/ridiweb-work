import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TasksView } from "@/components/tasks/tasks-view";
import type { ClientService, Task, TaskTemplate } from "@/types/database";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ taskId?: string }> }) {
  const { taskId } = await searchParams;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [tasksRes, profilesRes, clientsRes, templatesRes, servicesRes] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, name").order("name"),
      supabase
        .from("clients")
        .select("id, name")
        .order("is_internal", { ascending: false })
        .order("name"),
      supabase.from("task_templates").select("*").order("created_at"),
      supabase.from("client_services").select("*"),
    ]);

  return (
    <TasksView
      key={taskId ?? "all"}
      initialTaskId={taskId}
      me={{ id: profile.id, role: profile.role }}
      initialTasks={(tasksRes.data ?? []) as Task[]}
      profiles={(profilesRes.data ?? []) as { id: string; name: string }[]}
      clients={(clientsRes.data ?? []) as { id: string; name: string }[]}
      initialTemplates={(templatesRes.data ?? []) as TaskTemplate[]}
      services={(servicesRes.data ?? []) as ClientService[]}
    />
  );
}
