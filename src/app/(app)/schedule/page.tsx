import { moaiCalendar } from "@/lib/moai/types";
import { workspaceAccess } from "@/lib/workspace-access";
import { lectureCalendar } from "@/lib/lectures/types";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScheduleView } from "@/components/schedule/schedule-view";
import type { CalendarEvent } from "@/types/database";

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export default async function SchedulePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const access=await workspaceAccess(supabase,profile.id);
  if(access.restricted){
    const [moai,shared]=await Promise.all([supabase.from("moai_gatherings").select("id,title,sessions,state,archived").eq("archived",false),supabase.rpc("moai_shared_schedule")]);
    return <ScheduleView readOnly moai={moaiCalendar(moai.data||[])} shared={shared.data||[]} moaiError={!!moai.error||!!shared.error} lectures={[]} lecturesError={false} me={{id:profile.id}} today={kstToday()} initialEvents={[]} tasks={[]} invoices={[]} clients={[]} profiles={[]}/>;
  }
  // 세금계산서 발행일 — 조회는 팀 전체 (쓰기는 owner 전용, RLS 0023)
  const [eventsRes, tasksRes, invoicesRes, clientsRes, profilesRes, lecturesRes,moaiRes] =
    await Promise.all([
      supabase.from("events").select("*").order("event_date"),
      supabase
        .from("tasks")
        .select("id, title, due_date, status, assignee_id")
        .not("due_date", "is", null),
      supabase
        .from("tax_invoices")
        .select("id, issue_date, counterparty, status")
        .neq("status", "cancelled"),
      supabase.from("clients").select("id, name"),
      supabase.from("profiles").select("id, name"),
      supabase.from("lecture_projects").select("id,title,sessions,archived,stage,next_action,next_action_date").eq("archived",false),
      supabase.from("moai_gatherings").select("id,title,sessions,state,archived").eq("archived",false),
    ]);

  return (
    <ScheduleView
      moai={moaiCalendar(moaiRes.data||[])} moaiError={!!moaiRes.error}
      lectures={lectureCalendar(lecturesRes.data || [])}
      lecturesError={!!lecturesRes.error}
      me={{ id: profile.id }}
      today={kstToday()}
      initialEvents={(eventsRes.data ?? []) as CalendarEvent[]}
      tasks={
        (tasksRes.data ?? []) as {
          id: string;
          title: string;
          due_date: string;
          status: string;
          assignee_id: string | null;
        }[]
      }
      invoices={
        (invoicesRes.data ?? []) as {
          id: string;
          issue_date: string;
          counterparty: string;
        }[]
      }
      clients={(clientsRes.data ?? []) as { id: string; name: string }[]}
      profiles={(profilesRes.data ?? []) as { id: string; name: string }[]}
    />
  );
}
