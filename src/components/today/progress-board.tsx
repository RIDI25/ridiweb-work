import Link from "next/link";
import { PartnerBadge } from "@/components/clients/partnership";
import type { PartnerLink } from "@/lib/service-partners";
import { recordDate, type ClientProgress, type ReviewItem, type WaitingItem } from "@/lib/workspace-progress";
import styles from "./progress-board.module.css";

export function ReviewInbox({ reviews, unavailable = false }: { reviews: ReviewItem[]; unavailable?: boolean }) {
  return <section className={styles.block} aria-labelledby="review-inbox-title">
    <div className={styles.sectionHead}><h2 id="review-inbox-title">확인 대기 <span className={styles.count}>{reviews.length}</span></h2><span>콘텐츠 · 업무 검토</span></div>
    {reviews.length ? <ul>{reviews.map((review) => <li key={review.key} className={styles.reviewRow}>
      <div className={styles.clientLabel}>{review.clientName}</div>
      <div><strong>{review.title}</strong><p className={styles.secondary}>{review.detail}</p><p className={styles.caption}>{review.kind} · {recordDate(review.updatedAt)} 등록 기록</p></div>
      <Link href={review.href} className={styles.button}>검토하기</Link>
    </li>)}</ul> : <p className={styles.empty}>{unavailable ? "검토 기록을 불러오지 못해 확인 대기 여부를 알 수 없습니다." : "등록된 확인 대기 항목이 없습니다."}</p>}
  </section>;
}

export function ClientProgressTable({ clients, title = true, partners = {} }: { clients: ClientProgress[]; title?: boolean; partners?: Record<string, PartnerLink[]> }) {
  return <section className={styles.block} aria-label="고객별 진행 현황">
    {title && <div className={styles.sectionHead}><h2>고객별 진행 현황</h2><Link href="/clients">전체 고객 보기 →</Link></div>}
    {clients.length ? <table className={styles.table}>
      <colgroup><col style={{ width: "28%" }} /><col style={{ width: "34%" }} /><col style={{ width: "38%" }} /></colgroup>
      <thead><tr><th scope="col">고객 · 현재 단계</th><th scope="col">최근 기록</th><th scope="col">다음 행동</th></tr></thead>
      <tbody>{clients.map((client) => <tr key={client.id}>
        <td className={styles.clientCell}><Link href={`/clients/${client.id}/overview`} className={styles.clientName}>{client.name}</Link>{client.isInternal && <span className={styles.internal}>내부</span>}
          <div className="mt-1 flex flex-wrap gap-1">{(partners[client.id] ?? []).map((partner) => <PartnerBadge key={partner.id} partner={partner} />)}</div>
          <p className={styles.secondary}>{client.services.length ? client.services.join(" · ") : "진행 계약 미등록"}</p>
          <span className={`${styles.badge} ${client.tone === "review" ? styles.reviewBadge : client.tone === "active" ? styles.activeBadge : ""}`}>{client.stage}</span>
          {client.clientStatus !== "active" && <p className={styles.caption}>고객 상태 · {client.clientStatus === "paused" ? "일시중지" : "종료"}</p>}
        </td>
        <td data-label="최근 기록"><p>{client.recent ?? "업무·검수 기록 없음"}</p><p className={styles.secondary}>{client.recentAt ? `${recordDate(client.recentAt)} 기록` : "현재 진행 상황을 등록해 주세요."}</p>{client.stale && <p className={styles.caption}>7일 이상 경과 · 현재 상황 재확인 필요</p>}</td>
        <td data-label="다음 행동">{client.next ? <><Link href={client.next.href} className={styles.next}>{client.next.title}</Link><p className={styles.secondary}>{client.next.assignee} · {client.next.due ? `${client.next.due}까지` : "기한 미정"}</p></> : <><p>다음 작업 확인 필요</p><Link href={`/clients/${client.id}/overview`} className={styles.secondaryLink}>고객 진행 건 확인 →</Link></>}<p className={styles.waiting}>{client.waiting}</p></td>
      </tr>)}</tbody>
    </table> : <p className={styles.empty}>표시할 고객이 없습니다.</p>}
  </section>;
}

export function WaitingBoard({ items, unavailable = false }: { items: WaitingItem[]; unavailable?: boolean }) {
  return <section className={styles.block} aria-labelledby="waiting-board-title">
    <div className={styles.sectionHead}><h2 id="waiting-board-title">응답 · 처리 대기 <span className={styles.count}>{items.length}</span></h2><span>재확인일 순</span></div>
    {items.length ? <ul>{items.map((item) => <li key={item.id} className={styles.reviewRow}>
      <div className={styles.clientLabel}>{item.clientName}<p className={styles.caption}>{item.party}</p></div>
      <div><strong>{item.title}</strong><p className={styles.secondary}>{item.reason}</p><p className={styles.caption}>{item.followup ? `${item.followup} 재확인${item.overdue ? " · 확인할 때가 됐어요" : ""}` : "재확인일을 정해 주세요"}</p></div>
      <Link href={item.href} className={styles.button}>대기 확인</Link>
    </li>)}</ul> : <p className={styles.empty}>{unavailable ? "대기 기록을 불러오지 못했습니다." : "등록된 응답·처리 대기가 없습니다."}</p>}
  </section>;
}
