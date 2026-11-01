import Link from "next/link";
import { safeAssistantHref } from "@/lib/assistant/lecture-links";

export function AssistantText({ text }: { text: string }) {
  return text.split(/(\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    const match = /^\[([^\]\n]+)\]\(([^\s)]+)\)$/.exec(part);
    if (!match || !safeAssistantHref(match[2])) return part;
    return match[2].startsWith("/api/") ? <a key={index} href={match[2]} download>{match[1]}</a> : <Link key={index} href={match[2]}>{match[1]}</Link>;
  });
}
