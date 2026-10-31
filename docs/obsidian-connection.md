# 옵시디언 연결 운영

회의록은 워크스페이스의 팀 공유 자료이고, 옵시디언 검색 사본은 연결한 계정의 개인 자료다. 기존 노트는 옵시디언에서 수정한다. 회의록을 볼트에도 보관하려면 회의록 메뉴에서 Markdown을 내려받아 볼트에 넣는다. 자동 양방향 편집은 하지 않는다.

## 맥 연결

`/Users/park-yuri/Library/Application Support/Optify/obsidian/config.json`에 `ownerId`, `vaultPath`, `envFile`을 저장한다. 설정에는 키를 복사하지 않고 기존 워크스페이스 `.env.local` 경로만 둔다. 파일 권한은 600. `ownerId`는 실제 연결 계정을 확인하고 지정한다.

연결 스크립트: `node scripts/obsidian-sync.mjs --config /absolute/config.json`

설치된 LaunchAgent: `~/Library/LaunchAgents/kr.optify.obsidian-sync.plist`. 로그인 중 맥이 깨어 있고 인터넷에 연결되면 60초 간격으로 실행한다. 변경이 없으면 상태만 갱신하고 1시간마다 전체 사본을 재검증한다. 맥이 꺼지거나 잠들면 마지막 사본을 사용하고 화면에 마지막 반영 시각을 표시한다. 로그와 마지막 검사 지문은 설정 파일 옆에 저장하며 노트 본문·키를 로그에 쓰지 않는다.

중지: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/kr.optify.obsidian-sync.plist`
재개: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.optify.obsidian-sync.plist`

중지해도 검색 사본은 남는다. 연결 해제와 사본 제거는 별도 명시적인 요청이 있을 때 본인 데이터 범위만 처리한다. 원본 볼트는 유지한다. 경로 변경 시 config의 vaultPath를 바꾸고 연결을 다시 실행한다. 다른 Mac으로 이동할 때 기존 작업을 먼저 중지한다.

## 검증

`npm test`, `npm run lint`, `npm run build`와 `node --test scripts/obsidian-sync.test.mjs`를 실행한다. `PGLITE_MODULE=/absolute/pglite/dist/index.js node supabase/tests/meetings-vault.mjs`는 임시 PostgreSQL에서 개인 자료 격리·비로그인 차단·브리지 권한·동시 수정·보관/복원·전체 스캔의 원자성을 검증한다.

한 번에 5,000개 노트·20MB까지, 개별 파일은 1MB까지다. 검색은 한글을 포함한 키워드 일치 방식(공백으로 나눈 단어 모두 포함)이며 의미 유사도 검색은 아니다. 화면은 검색당 최대 30개, 비서는 8개를 찾고 긴 본문을 12,000자씩 이어서 읽는다. PDF·이미지·오디오는 인덱싱하지 않는다.

## 비서 채팅의 주간 보관

비서 채팅 메뉴에서 대화방을 고정할 수 있다. 다른 화면의 하단 비서 아이콘은 같은 대화를 연다. 전송한 메시지는 모델 호출 전에 저장하고, 답변과 확인한 작업 결과도 저장한다. 배포 이전에 브라우저 새로고침으로 사라진 대화는 복구할 수 없다.

기존 LaunchAgent가 매주 월요일 오전 9시(한국 시간)부터 지난 주 자료를 처리한다. 전주 범위는 월요일 00:00~다음 월요일 00:00이며, 맥이 꺼져 있었으면 다음 연결 시 순차 보관한다. **첫 정규 보관은 2026-11-02 09:00 KST 이후**다. 별도의 Codex 예약 작업에 의존하지 않는다.

보관 위치: `40_기록/옵티파이 비서/YYYY-MM-DD/주간 요약-<보관ID>.md` 및 `대화 원문-<보관ID>.md`. 요약은 Claude Fable 5.1을 사용하고 사용량을 워크스페이스에 기록한다. 원문은 모든 메시지·시각·대화방·업무 대상·작업 메타데이터를 보존한다.

두 파일의 실제 쓰기·재읽기·내용 일치가 확인된 뒤에만 해당 메시지를 보관 완료로 표시한다. 다른 내용이 담긴 기존 파일·심볼릭 링크는 덮어쓰지 않는다. 실패하면 최소 15분 뒤 재시도하며 대화는 앱에 남는다. 고정한 대화, 새 메시지가 있는 대화, 응답 진행 중이거나 아직 확인할 작업이 있는 대화는 목록에 유지한다. 고정을 해제한 대화는 모든 메시지가 이미 보관된 상태면 다음 연결 때 정리될 수 있다. 목록에서 정리한 대화도 DB에는 남아 있어 복구 가능하다.

보관 검증: `node --test scripts/assistant-archive.test.mjs` 및 `PGLITE_MODULE=/absolute/pglite/dist/index.js node supabase/tests/assistant-history.mjs`.
