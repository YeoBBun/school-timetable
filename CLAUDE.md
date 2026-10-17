# CLAUDE.md — 인수인계 노트

이 저장소에서 작업하는 Claude 에게 남기는 메모입니다. 사람용 사용 설명은 [README.md](README.md) 에 있습니다.

## 사용자
- 교사 1명(혼자 사용). PC 위주, 학교와 집에서 씁니다. 국어 101~105반을 가르칩니다.
- **한국어로 대화**하고, 전문 용어보다 **쉬운 말과 단계별 안내**를 좋아합니다. "뭘 하라는 거야?"라는 반응이 나오면 더 쉽게 다시 설명하세요.
- 사용자가 직접 해야 하는 일(구글 로그인, 콘솔 설정 등)은 누를 버튼 이름까지 짧게 알려 주세요.

## 프로젝트 한 줄 요약
반별 수업 관리(한 줄 진도 기록 · 반 메모 · 자료) + 교사 시간표를 다루는 **정적 웹앱**입니다(빌드 없음, 순수 HTML/CSS/ES 모듈).
**구글 로그인 + 구글 드라이브**에만 저장하고, 서버나 DB는 없습니다(예전에 쓰던 Supabase 는 제거했습니다).

## 구조
```
index.html, css/style.css
js/config.js        GOOGLE_CLIENT_ID (공개 값, 이미 입력됨)
js/google.js        Google Identity Services 토큰 로그인 + Drive v3 API (drive.file 권한만)
js/store.js         메모리 DB + 드라이브 저장/동기화 + 조회 도우미
js/app.js           로그인 화면, 메뉴, 화면 전환(hash 라우팅), 동기화 배지
js/ui.js            h() DOM 도우미, modal, toast, 날짜 함수
js/views/home.js    첫 화면: 오늘 시간표 + 담당 반 칸(단원 고르기, 한 줄 기록, 반 메모, 최근 기록)
js/views/records.js 기록 수정 · 다른 반에도 쓰기 · 반 메모 창 (공용)
js/views/classpage.js  #/class/<반id> 반 전체 기록
js/views/search.js  찾기(기록 · 자료 · 메모 검색, 단원별 보기)
js/views/materials.js  자료 화면 + 업로드/첨부 공용 함수
js/views/timetable.js, settings.js
serve.py            캐시 끈 로컬 서버 → http://localhost:5500
```

### 데이터 저장 방식 (store.js)
- 모든 테이블을 드라이브 `진도관리/진도관리-데이터.json` **한 파일**에 저장합니다. 수업 자료 파일은 `진도관리/수업 자료/` 폴더에 둡니다.
- 테이블: classes, timetable_slots, timetable_changes, lessons, materials, lesson_materials, days_off, settings, units, class_notes, folders
  (curriculum_items · item_materials 는 예전 '차시 목록' 방식의 데이터 보존용으로만 남아 있고 화면에서는 안 씁니다. 예전 기록은 `lessonText()` 가 차시 제목을 대신 보여 줍니다.)
- **학년도 · 학기**: `termOf(날짜)` — 3월 시작, 1~2월은 앞 학년도 2학기, 2학기 시작일은 settings.sem2_start('MM-DD', 기본 '08-01'). 반은 `year` 를 가지며(없으면 created_at 으로 계산) 첫 화면에는 그 학년도 반만 나옵니다. 단원(units)은 year+semester 마다.
- **기록(lessons)**: memo = 한 줄 내용, unit_id = 단원. 교시는 그날 시간표에서 아직 기록 없는 첫 교시를 자동으로(`freePeriod`).
- **자료 폴더**: `materialFolder()` 가 `수업 자료/{year}학년도/{n}학기/{단원}/{수업|평가}` 를 만들고 id 를 folders 테이블(key: 'y:2026', 's:2026:2', 'u:단원id', 'p:단원id:lesson|eval')에 저장해 기기끼리 공유합니다. 처음 쓸 때 휴지통 여부를 확인하고, 지워졌으면 다시 만듭니다. 단원 이름을 바꾸면 폴더 이름도, 자료의 단원/구분을 바꾸면 파일도 옮깁니다(google.js renameFile/moveFile).
- 화면 코드는 `S.db.from(table).insert/update/upsert/delete().eq/in/match` 같은 **supabase-js 비슷한 체인**을 씁니다. 메모리에서 바로 실행되고, 저장은 0.7초 디바운스로 묶여 드라이브에 씁니다.
- **기기 간 병합**: 행마다 `_u`(마지막 수정 ms)를 두고, 지운 행은 `tomb[table][key] = 지운 시각`으로 기억합니다(90일 보관). 저장 직전 드라이브 파일 version 이 바뀌어 있으면 먼저 합치고 씁니다. 30초 폴링과 창 포커스 때도 확인합니다.
- 기본키가 id 가 아닌 테이블: item_materials(item_id, material_id), lesson_materials(lesson_id, material_id), settings(user_id). user_id 는 항상 `'me'` 입니다.
- 삭제 연쇄(cascadeDelete): 반 → 시간표·변경·수업기록·반 메모, 수업기록 → lesson_materials, 자료 → 연결들, 단원 → 기록·자료의 unit_id 를 null 로.
- **브라우저 사본(빠른 시작)**: 마지막 데이터와 드라이브 파일 id 를 localStorage `jindo.cache` 에 둡니다. 켜면 사본으로 화면부터 그리고(배지 "연결 중…"), `loadAll()` 이 드라이브 파일을 읽어 `applyRemote` 로 합칩니다. 아는 파일 id 가 있으면 요청 2번(fileMeta → readJson), 없으면 폴더 찾기부터 합니다. 사본의 `dirty` 가 true 면 합친 뒤 저장합니다. 60일 넘은 사본은 버립니다(지운 기록 90일보다 짧게). 로그아웃하면 지웁니다. 토큰이 만료돼도 사본이 있으면 로그인 화면 대신 앱을 보여 주고 배지에 **다시 연결**을 띄웁니다.
- 로그인 토큰은 약 1시간 동안 localStorage 에 둡니다. 만료되면 AuthError → 배지에 **다시 연결** 버튼이 뜨고, 누르면 `S.resume()` 으로 밀린 저장을 이어서 합니다.

### 주요 기능 규칙
- **첫 화면**(#/today): 위에 그날 시간표(`S.effectiveSlots` = 주간 시간표 + timetable_changes, class_id null 이면 결강), 아래에 담당 반 칸. 칸마다 단원 선택(기본: 그 반이 이번 학기 마지막으로 쓴 단원), 한 줄 입력(Enter, 한글 조합 중 Enter 는 무시), 반 메모, 최근 기록 6개. 기록에 파일을 끌어다 놓으면 `attachDialog(lesson, files)`.
- **자료는 기록에 붙입니다**(lesson_materials). 같은 자료를 여러 반에 쓰면 연결만 여러 개.
- **시간표**: 위에서 반(붓)을 고르고 칸을 클릭하거나 드래그해서 칠합니다(pointer 이벤트).
- 화면 갱신: 다른 기기에서 온 변경(remote)은 사용자가 입력 중이거나 모달이 열려 있으면 미뤘다가 반영합니다.

## 현재 상태 (2026-10-16 기준)
- main 브랜치에 모든 작업이 합쳐져 있고(GitHub PR 로 병합), 로컬 PC 에서 실제 구글 로그인 · 드라이브 저장 · 파일 업로드까지 확인했습니다.
- 사용자 드라이브에 101~105반(국어)과 주간 시간표 20칸이 이미 저장되어 있습니다.
- OAuth 앱은 **테스트 모드**이고, 테스트 사용자는 사용자 본인 Gmail 하나입니다. 승인된 JavaScript 원본: `http://localhost:5500`, `https://yeobbun.github.io`.
- 노션에도 비슷한 구조의 비공개 페이지 "진도관리 (노션 버전)"를 만들어 두었습니다(비교용, 이 저장소와 연결 안 됨).

## 남은 일 / 사용자에게 제안해 둔 것
1. **보안 보강** — 끝남
   - 링크 주소 검사: linkDialog · editDialog 둘 다 `normalizeUrl()` 로 `http(s)://` 가 아니면 `https://` 를 붙입니다.
   - 공용 PC 모드: 사용자가 학교 PC도 혼자 쓴다고 해서 **만들지 않기로** 했습니다.
2. **GitHub Pages 배포** — 사용자가 켰습니다(main, `/ (root)`). 주소: `https://yeobbun.github.io/timetable/`. main 에 합치면 몇 분 뒤 반영됩니다.
3. **반별 수업관리 앱으로 개편** (사용자 요청, 2026-10-17)
   - 1단계 끝: 첫 화면(오늘 시간표 + 담당 반), 한 줄 기록, 반 메모, 찾기, 자료 자동 폴더 정리, 학년도·학기.
   - 2단계(나이스 파일 견본 필요, 사용자가 월요일에 올려 주기로 함): 학급 명렬표 엑셀을 올리면 학생 목록 생성, 학생 메모, 수행평가 점수 입력 → **나이스에서 받은 양식에 점수를 채워** 일괄 입력용 엑셀 내려받기, 조 편성, 칭찬 스티커(가칭). 개인정보는 사용자가 학교에 확인해 괜찮다고 함. 견본 파일은 공개 저장소에 절대 올리지 말고 드라이브로 받기.
   - 3단계: 구글 캘린더 연동('진도관리' 캘린더를 따로 만들어 반별 수행평가 날짜 · 중요 일정). 콘솔에서 Calendar API 사용 설정 + 권한 추가가 필요.

## 작업할 때
- 코드 스타일: 2칸 들여쓰기, 작은따옴표, 주석은 한국어로 짧게, `h()` 로 DOM 을 만듭니다. 사용자에게 보이는 문구는 모두 한국어입니다.
- **테스트**: 실제 구글 로그인은 사용자만 할 수 있습니다(비밀번호를 대신 입력하면 안 됨). UI 를 확인할 때는 `js/google.js` 를 가짜(localStorage 를 드라이브처럼 쓰는 버전)로 바꾼 **복사본을 임시 폴더에** 만들어 띄웠습니다. 탭 두 개를 열면 기기 두 대처럼 병합을 시험할 수 있습니다. 저장소 안의 google.js 는 바꾸지 마세요.
- 커밋과 푸시는 사용자가 요청할 때만 합니다. 커밋 메시지는 한국어로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 를 붙입니다.
- 학생 개인정보: 사용자가 학교에 확인해 저장해도 된다고 함(2026-10-17). 그래도 공개 저장소 · 로그 · 대화에 학생 실명을 옮겨 적지 마세요.
