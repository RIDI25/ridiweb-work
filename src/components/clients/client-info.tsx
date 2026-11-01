"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/components/providers/client-context";
import { ClientServicesSection } from "@/components/settings/client-services";
import { ChannelAccountsSection, ClientCard, DangerZone, WordpressTab } from "@/components/clients/client-info-sections";
import { ClientBriefCard } from "@/components/clients/client-brief";
import { BizRegCard } from "@/components/clients/biz-reg-card";
import { TrackerTargetsCard } from "@/components/clients/tracker-targets-card";
import { clientPath } from "@/lib/nav";
import type { Profile } from "@/types/database";

/**
 * 고객사 카드 › 기본정보. 설정 메뉴에 있던 고객사 항목(계약·기본 정보·온보딩·채널 계정·워드프레스)을 이리로 옮겼다.
 * 블록마다 그 자리에서 수정한다. (2차: 콘텐츠 기준 폼, 추적 설정 편집)
 */
export function ClientInfo({ id }: { id: string }) {
  const { clients, refreshClients } = useClientContext();
  const router = useRouter();
  const client = clients.find((c) => c.id === id) ?? null;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    let active = true;
    createClient()
      .from("profiles")
      .select("*")
      .then(({ data }) => {
        if (active) setProfiles((data ?? []) as Profile[]);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!client) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">계약 서비스</h2>

        <ClientServicesSection key={client.id} clientId={client.id} readOnly={false} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">기본 정보 · 온보딩</h2>
        <ClientCard client={client} readOnly={false} onSaved={() => void refreshClients()} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">사업자등록증</h2>
        <BizRegCard key={client.id} clientId={client.id} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">채널 계정</h2>
        <ChannelAccountsSection key={client.id} clientId={client.id} profiles={profiles} readOnly={false} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">워드프레스 연결</h2>
        <WordpressTab key={client.id} clients={[client]} readOnly={false} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">콘텐츠 기준</h2>
        <ClientBriefCard clientId={client.id} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">측정 키워드·질문 (트래커)</h2>
        <p className="text-xs text-muted">
          고객사가 요청한 검색어와 AI 질문. 메인 키워드 5개, 서브 키워드 20개, 질문 20개까지. 저장하면 맥 트래커 설정에 반영되고 다음 측정부터 이 목록으로 잽니다. 경쟁사·별칭은 아직 맥의 트래커 앱에서 고칩니다. 결과는{" "}
          <Link href={clientPath(client.id, "geo")} className="text-accent-deep hover:underline">
            GEO
          </Link>{" "}
          ·{" "}
          <Link href={clientPath(client.id, "seo")} className="text-accent-deep hover:underline">
            SEO
          </Link>{" "}
          탭에서 봅니다.
        </p>
        <TrackerTargetsCard key={client.id} clientId={client.id} />
      </section>

      {!client.is_internal && (
        <DangerZone
          client={client}
          onDeleted={() => {
            void refreshClients();
            router.push("/clients");
          }}
        />
      )}
    </div>
  );
}
