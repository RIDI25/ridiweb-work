# RIDIWEB

고객 업무·일정·회의록·SEO/GEO·정산을 관리하는 내부 워크스페이스입니다.

- 총괄 기획·비서: Claude Fable 5.1
- 비서가 맡기는 분석·작성·검토: GPT-6 Astra
- 운영 화면: https://ridiweb-work.vercel.app/
- GitHub: https://github.com/RIDI25/ridiweb-work
- Vercel 프로젝트: `ridiweb-work`
- Supabase 프로젝트: `ridiweb-work` (기존 프로젝트·데이터 유지)

`.env.example`을 참고해 서버 키를 설정하고 `npm install`, `npm run dev`로 시작합니다. 비서 팀은 `ANTHROPIC_API_KEY`와 `OPENAI_API_KEY`가 모두 필요합니다. 키는 커밋하지 않습니다.

검증: `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`.
현재 기능·운영 절차의 상세 기준은 [CLAUDE.md](CLAUDE.md), 프레임워크 지침은 [AGENTS.md](AGENTS.md)를 참고합니다.
