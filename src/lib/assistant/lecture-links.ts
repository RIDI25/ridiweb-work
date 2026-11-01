export function lectureDocumentHref(doc: { id: string; project_id: string | null; kind: string }) {
  return `/lectures/${doc.project_id || (doc.kind === "profile" ? "profile" : "library")}?document=${doc.id}`;
}
/** Only verified internal destinations are made clickable in assistant prose/cards. */
export function safeAssistantHref(href: string) {
  return /^\/moai\/[0-9a-f-]{36}$/i.test(href) || /^\/lectures(?:\/(?:[0-9a-f-]{36}|library|profile))?(?:\?document=[0-9a-f-]{36})?$/i.test(href) || /^\/api\/lectures\/export\?id=[0-9a-f-]{36}(?:&format=md)?$/i.test(href);
}
