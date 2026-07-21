# 멘토링 예약 시스템

ZEP Space Manager 스타일의 멘토링 룸 예약 시스템입니다.
**추가 비용 0원**으로 운영 가능합니다.

## 기능

### 사용자
- 시간표 그리드 뷰 (룸 × 시간 슬롯) — **일간 / 주간 뷰 전환**
- 데스크톱: 드래그로 여러 시간 슬롯 선택 / **모바일: 시작·종료 슬롯 2번 탭으로 선택**
- 날짜 이동 (이전/다음, 달력 선택)
- 예약 생성/수정/삭제 (비밀번호 기반)
- **내 예약 조회** — 이름 + 비밀번호로 내 예약 목록 확인·취소
- **이메일 알림 (선택)** — 예약 확정/취소 시 확인 메일 발송
- 강사별 캘린더 (드롭다운 선택), 타 강사 룸 사용 현황 표시
- 스켈레톤 로딩, 반응형 디자인

### 관리자
- **통계 대시보드** — 전체/예정/오늘 예약, 누적 시간, 강사·룸·요일·시간대별 차트
- 전체 예약 조회, 검색, 강제 삭제, **CSV 내보내기**
- 강사 추가/이름 변경/삭제 (예정 예약이 있으면 경고 후 확인)
- **룸 사용 차단** — 시설 점검 등으로 특정 날짜·시간대 예약 차단
- **세션 토큰 인증** — 비밀번호는 로그인 시 1회만 전송 (6시간 유효, 활동 시 자동 연장)

### 안정성
- **LockService 동시성 제어** — 동시 예약 시에도 중복 예약 방지
- 예약 비밀번호 SHA-256 해시 저장
- 날짜별 응답 캐시(CacheService)로 조회 속도 개선
- 데모 모드 (GAS 미연결 시 localStorage로 동작)

## 설정 방법

### 1단계: Google Sheets + Apps Script 백엔드 설정

1. [Google Sheets](https://sheets.google.com)에서 새 스프레드시트를 생성합니다.

2. 메뉴에서 **확장 프로그램 > Apps Script**를 클릭합니다.

3. `gas/Code.gs` 파일의 내용을 전체 복사하여 Apps Script 에디터의 `Code.gs`에 붙여넣습니다.

4. **함수 선택 드롭다운**에서 `setup`을 선택하고 **실행** 버튼을 클릭합니다.
   (처음 실행 시 권한 승인이 필요합니다 — 이메일 알림을 위해 메일 권한도 포함됩니다)

5. **배포 > 새 배포**를 클릭합니다:
   - 유형: **웹 앱**
   - 실행 권한: **본인(나)**
   - 액세스: **모든 사용자**

6. **배포** 버튼을 클릭하고 생성된 **URL을 복사**합니다.

7. `js/config.js`의 `SCRIPT_URL`에 복사한 URL을 입력합니다.

> **코드 수정 후 재배포할 때는** 반드시 "배포 > 배포 관리 > 수정 > 새 버전"을 사용하세요.
> "새 배포"를 만들면 URL이 바뀌어 config.js가 깨집니다.

### 2단계: 룸 / 운영시간 설정

**Google Sheets의 "설정" 시트**에서 직접 수정합니다 (코드 수정·재배포 불필요):

| key | value | 설명 |
|-----|-------|------|
| `adminPassword` | `admin1234` | 관리자 비밀번호 |
| `rooms` | `멘토링룸 1,멘토링룸 2,...` | 쉼표로 구분된 룸 목록 |
| `startHour` | `9` | 운영 시작 시간 (24시간) |
| `endHour` | `22` | 운영 종료 시간 |
| `slotMinutes` | `30` | 슬롯 단위 (분) |

`js/config.js`의 rooms/startHour 등은 **데모 모드용 + 로딩 전 기본값**이며,
서버 연결 시 "설정" 시트 값으로 덮어씌워집니다.

### 3단계: 웹 호스팅 (GitHub Pages - 무료)

1. GitHub 저장소에 push한 뒤 **Settings > Pages**에서:
   - Source: **Deploy from a branch**, Branch: **main** / **/ (root)**
2. 몇 분 후 `https://사용자명.github.io/저장소명/`에서 접속 가능합니다.

## v1 → v2 업그레이드 (기존 운영 중인 경우)

1. Apps Script 에디터에서 `Code.gs`를 새 버전으로 교체합니다.
2. **`setup` 함수를 한 번 실행**합니다 — 기존 데이터를 유지한 채 아래가 자동 추가됩니다:
   - "예약" 시트에 `email` 컬럼 (13번째)
   - "차단" 시트 (룸 차단용)
   - "설정" 시트에 `rooms` / `startHour` / `endHour` / `slotMinutes` 키
3. **배포 관리 > 수정 > 새 버전**으로 재배포합니다 (URL 유지).
4. 프론트엔드 파일(html/css/js)을 전부 새 버전으로 교체하고 push합니다.
   - `js/api-demo.js`가 새로 추가되었으니 누락하지 마세요.

## clasp로 배포하기 (선택 — 복붙 없이 CLI로 push)

수동 복사·붙여넣기 대신 [clasp](https://github.com/google/clasp)를 쓰면 git의 `gas/` 폴더를 그대로 배포할 수 있습니다:

```bash
npm install -g @google/clasp
clasp login

# Apps Script 에디터 > 프로젝트 설정에서 "스크립트 ID" 복사 후:
cp .clasp.json.example .clasp.json   # scriptId 입력
clasp push                            # gas/ 폴더 업로드
```

> 최초 1회 [Apps Script API 사용 설정](https://script.google.com/home/usersettings)이 필요합니다.
> `clasp push` 후에도 웹앱 반영은 "배포 관리 > 새 버전"으로 해야 합니다 (`clasp deploy -i <deploymentId>`로도 가능).

## 관리자

- 기본 비밀번호: `admin1234` → **"설정" 시트에서 반드시 변경하세요**
- 로그인하면 세션 토큰이 발급되며 브라우저 탭을 닫으면 만료됩니다

## 데모 모드

`config.js`의 `SCRIPT_URL`이 비어있으면 **데모 모드**로 동작합니다.
브라우저의 localStorage에 데이터가 저장되며, Google Sheets 없이도 전체 기능(통계·차단 포함)을 테스트할 수 있습니다.

## 파일 구조

```
├── index.html          # 메인 예약 현황 페이지 (일간/주간 뷰, 내 예약)
├── admin.html          # 관리자 페이지 (통계, 강사/차단/예약 관리)
├── css/
│   └── style.css       # 스타일
├── js/
│   ├── config.js       # 기본 설정 (API URL, 데모용 기본값)
│   ├── app.js          # 메인 앱 로직
│   ├── api.js          # API 통신 모듈
│   ├── api-demo.js     # 데모 모드 구현 (localStorage)
│   └── admin.js        # 관리자 페이지 로직
├── gas/
│   ├── Code.gs         # Google Apps Script 백엔드
│   └── appsscript.json # GAS 프로젝트 설정 (clasp용)
├── .clasp.json.example # clasp 설정 템플릿
└── README.md
```

## 시트 구조

| 시트 | 컬럼 |
|------|------|
| 예약 | id, date, instructor, room, startTime, endTime, name, course, topic, people, password(해시), createdAt, email |
| 설정 | key, value |
| 강사 | name |
| 차단 | id, date, room, startTime, endTime, reason, createdAt |

## 기술 스택

- **프론트엔드**: HTML, CSS, Vanilla JavaScript (빌드 없음)
- **백엔드**: Google Apps Script (무료) — LockService, CacheService, MailApp
- **데이터베이스**: Google Sheets (무료)
- **호스팅**: GitHub Pages (무료)
- **총 비용**: 0원 (이메일은 GAS 무료 쿼터 일 100건 내)
