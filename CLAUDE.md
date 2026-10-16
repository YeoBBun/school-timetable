# CLAUDE.md — 인수인계 노트

이 저장소에서 작업하는 Claude 에게 남기는 메모입니다. 사람용 사용 설명은 [README.md](README.md) 에 있습니다.

## 사용자
- 교사 1명(혼자 사용). PC 위주, 학교와 집에서 씁니다. 국어 101~105반을 가르칩니다.
- **한국어로 대화**하고, 전문 용어보다 **쉬운 말과 단계별 안내**를 좋아합니다. "뭘 하라는 거야?"라는 반응이 나오면 더 쉽게 다시 설명하세요.
- 사용자가 직접 해야 하는 일(구글 로그인, 콘솔 설정 등)은 누를 버튼 이름까지 짧게 알려 주세요.

## 프로젝트 한 줄 요약
반별 진도 기록 · 교사 시간표 · 수업 자료를 관리하는 **정적 웹앱**입니다(빌드 없음, 순수 HTML/CSS/ES 모듈).
**구글 로그인 + 구글 드라이브**에만 저장하고, 서버나 DB는 없습니다(예전에 쓰던 Supabase 는 제거했습니다).

## 구조
```
index.html, css/style.css
js/config.js        GOOGLE_CLIENT_ID (공개 값, 이미 입력됨)
js/google.js        Google Identity Services 토큰 로그인 + Drive v3 API (drive.file 권한만)
js/store.js         메모리 DB + 드라이브 저장/동기화 + 조회 도우미
js/app.js           로그인 화면, 메뉴, 화면 전환(hash 라우팅), 동기화 배지
js/ui.js            h() DOM 도우미, modal, toast, 날짜 함수
js/views/*.js       today / progress / timetable / curriculum / materials / settings
serve.py            캐시 끈 로컬 서버 → http://localhost:5500
```

### 데이터 저장 방식 (store.js)
- 모든 테이블을 드라이브 `진도관리/진도관리-데이터.json` **한 파일**에 저장합니다. 수업 자료 파일은 `진도관리/수업 자료/` 폴더에 둡니다.
- 테이블: classes, curriculum_items, timetable_slots, timetable_changes, lessons, materials, item_materials, lesson_materials, days_off, settings
- 화면 코드는 `S.db.from(table).insert/update/upsert/delete().eq/in/match` 같은 **supabase-js 비슷한 체인**을 씁니다. 메모리에서 바로 실행되고, 저장은 0.7초 디바운스로 묶여 드라이브에 씁니다.
- **기기 간 병합**: 행마다 `_u`(마지막 수정 ms)를 두고, 지운 행은 `tomb[table][key] = 지운 시각`으로 기억합니다(90일 보관). 저장 직전 드라이브 파일 version 이 바뀌어 있으면 먼저 합치고 씁니다. 30초 폴링과 창 포커스 때도 확인합니다.
- 기본키가 id 가 아닌 테이블: item_materials(item_id, material_id), lesson_materials(lesson_id, material_id), settings(user_id). user_id 는 항상 `'me'` 입니다.
- 삭제 연쇄(cascadeDelete): 반 → 시간표·변경·수업기록, 수업기록 → lesson_materials, 자료 → 연결들, 차시 → item_materials(+ 수업기록의 차시는 null 로).
- 로그인 토큰은 약 1시간 동안 localStorage 에 둡니다. 만료되면 AuthError → 배지에 **다시 연결** 버튼이 뜨고, 누르면 `S.resume()` 으로 밀린 저장을 이어서 합니다.

### 주요 기능 규칙
- **오늘 수업**: `S.effectiveSlots(date, weekday)` = 주간 시간표 + 그날의 timetable_changes(class_id 가 null 이면 결강). 카드마다 차시 선택, 메모, 자료 첨부를 합니다. 다음 차시는 그 반이 지금까지 나간 차시 중 가장 뒤 차시의 다음으로 추천합니다.
- **자료는 차시에 붙입니다**(item_materials). 그러면 그 차시를 고른 모든 반에 보입니다. 한 반에만 필요한 자료는 lesson_materials 로 붙입니다.
- **시간표**: 위에서 반(붓)을 고르고 칸을 클릭하거나 드래그해서 칠합니다(pointer 이벤트).
- 화면 갱신: 다른 기기에서 온 변경(remote)은 사용자가 입력 중이거나 모달이 열려 있으면 미뤘다가 반영합니다.

## 현재 상태 (2026-10-16 기준)
- main 브랜치 `760980c` 까지 푸시되어 있고, 로컬 PC 에서 실제 구글 로그인 · 드라이브 저장 · 파일 업로드까지 확인했습니다.
- 사용자 드라이브에 101~105반(국어)과 주간 시간표 20칸이 이미 저장되어 있습니다.
- OAuth 앱은 **테스트 모드**이고, 테스트 사용자는 사용자 본인 Gmail 하나입니다. 승인된 JavaScript 원본: `http://localhost:5500`, `https://yeobbun.github.io`.
- 노션에도 비슷한 구조의 비공개 페이지 "진도관리 (노션 버전)"를 만들어 두었습니다(비교용, 이 저장소와 연결 안 됨).

## 남은 일 / 사용자에게 제안해 둔 것
1. **보안 보강** — 끝남
   - 링크 주소 검사: linkDialog · editDialog 둘 다 `normalizeUrl()` 로 `http(s)://` 가 아니면 `https://` 를 붙입니다.
   - 공용 PC 모드: 사용자가 학교 PC도 혼자 쓴다고 해서 **만들지 않기로** 했습니다.
2. **GitHub Pages 배포**: Settings → Pages → Branch `main`, `/ (root)` → `https://yeobbun.github.io/timetable/`. 사용자가 직접 눌러야 합니다.
3. 쓰다가 요청이 오면 추가로 개발합니다.

## 작업할 때
- 코드 스타일: 2칸 들여쓰기, 작은따옴표, 주석은 한국어로 짧게, `h()` 로 DOM 을 만듭니다. 사용자에게 보이는 문구는 모두 한국어입니다.
- **테스트**: 실제 구글 로그인은 사용자만 할 수 있습니다(비밀번호를 대신 입력하면 안 됨). UI 를 확인할 때는 `js/google.js` 를 가짜(localStorage 를 드라이브처럼 쓰는 버전)로 바꾼 **복사본을 임시 폴더에** 만들어 띄웠습니다. 탭 두 개를 열면 기기 두 대처럼 병합을 시험할 수 있습니다. 저장소 안의 google.js 는 바꾸지 마세요.
- 커밋과 푸시는 사용자가 요청할 때만 합니다. 커밋 메시지는 한국어로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 를 붙입니다.
- 학생 개인정보(실명, 성적)는 저장하지 않도록 권장하는 방향을 유지하세요.
