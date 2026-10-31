import { signIn } from "@/lib/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const { error, redirect } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-subtle px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-accent" aria-hidden />
          <h1 className="text-lg font-bold text-ink">RIDIWEB</h1>
        </div>

        <form action={signIn} className="space-y-4">
          <input type="hidden" name="redirect" value={redirect ?? "/"} />

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            로그인
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-muted">
          계정은 관리자가 Supabase 대시보드에서 직접 생성합니다. 공개 가입은
          제공되지 않습니다.
        </p>
      </div>
    </main>
  );
}
