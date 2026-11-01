import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/assistant",
    name: "RIDIWEB 비서",
    short_name: "RIDIWEB",
    description: "옵티파이 · 모아이 · 강의 통합 비서",
    lang: "ko",
    start_url: "/assistant",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#41745b",
    icons: [
      { src: "/icons/ridiweb-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/ridiweb-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/ridiweb-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "비서 채팅", url: "/assistant" },
      { name: "통합 캘린더", url: "/schedule" },
    ],
  };
}
