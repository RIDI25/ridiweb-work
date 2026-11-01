import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 상위 디렉터리의 lockfile 때문에 워크스페이스 루트가 잘못 잡히는 것을 방지.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // PDF 내보내기 라우트가 런타임에 한글 폰트(OTF)를 읽을 수 있도록 번들 트레이싱에 포함.
  outputFileTracingIncludes: {
    "/api/reports/export": ["./public/fonts/**"],
    "/api/moai/attendance": ["./public/fonts/**"],
  },
};

export default nextConfig;
