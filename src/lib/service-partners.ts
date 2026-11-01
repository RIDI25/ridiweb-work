import type { ClientService } from "@/types/database";

export type ServiceChannel = "direct" | "partner";
export type ChannelFilter = "all" | ServiceChannel;
export type ServiceRelation = Pick<ClientService, "id" | "client_id" | "service_type" | "status" | "deal_channel" | "partner_id">;
export type CollaborationFields = Pick<ClientService, "deal_channel" | "partner_id" | "communication_contact" | "final_reviewer" | "settlement_party">;
export type PartnerLink = { id: string; name: string };

export function matchesServiceChannel(rows: ServiceRelation[], clientId: string, filter: ChannelFilter, partnerId = ""): boolean {
  if (filter === "all" && !partnerId) return true;
  return rows.some((row) => row.client_id === clientId && (filter === "all" || row.deal_channel === filter) && (!partnerId || row.partner_id === partnerId));
}

export function clientPartnerLinks(rows: ServiceRelation[], clientId: string, partners: PartnerLink[]): PartnerLink[] {
  const ids = new Set(rows.filter((row) => row.client_id === clientId && row.deal_channel === "partner" && row.partner_id).map((row) => row.partner_id));
  return partners.filter((partner) => ids.has(partner.id));
}

/** Shared by create, edit and renewal; a direct contract cannot keep a hidden partner. */
export function collaborationPatch(fields: CollaborationFields): Required<CollaborationFields> {
  const channel = fields.deal_channel ?? null;
  if (channel !== null && channel !== "direct" && channel !== "partner") throw new Error("거래 경로를 확인해 주세요.");
  const partner = channel === "partner" ? fields.partner_id?.trim() || null : null;
  if (channel === "partner" && !partner) throw new Error("협력사를 선택해 주세요.");
  const clean = (value: string | null | undefined) => {
    const text = value?.trim() || null;
    if (text && text.length > 300) throw new Error("담당 정보는 300자 이내로 입력해 주세요.");
    return text;
  };
  return { deal_channel: channel, partner_id: partner, communication_contact: clean(fields.communication_contact), final_reviewer: clean(fields.final_reviewer), settlement_party: clean(fields.settlement_party) };
}
