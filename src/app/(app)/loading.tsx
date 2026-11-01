/** Stream navigation feedback while fresh, permission-checked data is loading. */
export default function Loading() {
  return <div role="status" aria-label="화면 불러오는 중" className="mx-auto max-w-7xl py-2">
    <span className="sr-only">불러오는 중…</span>
    <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
      <div className="h-7 w-36 rounded-md bg-border" />
      <div className="h-32 rounded-xl bg-surface" />
      <div className="h-60 rounded-xl bg-surface" />
    </div>
  </div>;
}
