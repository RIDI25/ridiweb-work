/** Preserve the requested app page without accepting a redirect off this origin. */
export function safeAuthRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://ridiweb.local");
    if (url.origin !== "https://ridiweb.local" || url.pathname === "/login") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}
