import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScheduleView } from "@/components/schedule/schedule-view";
import type { CalendarEvent } from "@/types/database";

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export default async function SchedulePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  // 세금계산서 발행일 — 조회는 팀 전체 (쓰기는 owner 전용, RLS 0023)
  const [eventsRes, tasksRes, invoicesRes, clientsRes, profilesRes] =
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
    ]);

  return (
    <ScheduleView
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
