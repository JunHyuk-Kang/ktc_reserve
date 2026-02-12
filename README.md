# 멘토링 예약 시스템

ZEP Space Manager 스타일의 멘토링 룸 예약 시스템입니다.
**추가 비용 0원**으로 운영 가능합니다.

## 기능

- 시간표 그리드 뷰 (룸 × 시간 슬롯)
- 드래그로 여러 시간 슬롯 선택 예약
- 날짜 이동 (이전/다음, 달력 선택)
- 예약 생성/수정/삭제 (비밀번호 기반)
- 관리자 페이지 (전체 예약 조회, 검색, 강제 삭제)
- 반응형 디자인 (모바일 지원)
- 데모 모드 (GAS 미연결 시 localStorage로 동작)

## 설정 방법

### 1단계: 룸 및 시간 설정

[js/config.js](js/config.js) 파일을 열어 원하는 대로 수정하세요:

```js
const CONFIG = {
  title: '멘토링 예약 시스템',
  rooms: ['멘토링룸 1', '멘토링룸 2', ...],  // 룸 추가/삭제
  startHour: 9,      // 시작 시간
  endHour: 22,       // 종료 시간
  slotMinutes: 30,   // 슬롯 단위 (분)
  SCRIPT_URL: '',    // 2단계에서 입력
};
```

### 2단계: Google Sheets + Apps Script 백엔드 설정

1. [Google Sheets](https://sheets.google.com)에서 새 스프레드시트를 생성합니다.

2. 메뉴에서 **확장 프로그램 > Apps Script**를 클릭합니다.

3. `gas/Code.gs` 파일의 내용을 전체 복사하여 Apps Script 에디터의 `Code.gs`에 붙여넣습니다.

4. **함수 선택 드롭다운**에서 `setup`을 선택하고 **실행** 버튼을 클릭합니다.
   (처음 실행 시 권한 승인이 필요합니다)

5. **배포 > 새 배포**를 클릭합니다:
   - 유형: **웹 앱**
   - 설명: 멘토링 예약 시스템
   - 실행 권한: **본인(나)**
   - 액세스: **모든 사용자**

6. **배포** 버튼을 클릭하고 생성된 **URL을 복사**합니다.

7. `js/config.js`의 `SCRIPT_URL`에 복사한 URL을 입력합니다:
   ```js
   SCRIPT_URL: 'https://script.google.com/macros/s/AKfyc.../exec',
   ```

### 3단계: 웹 호스팅 (GitHub Pages - 무료)

1. GitHub에 새 저장소를 생성합니다.

2. 프로젝트 파일을 push합니다:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/사용자명/저장소명.git
   git push -u origin main
   ```

3. GitHub 저장소 > **Settings > Pages**에서:
   - Source: **Deploy from a branch**
   - Branch: **main** / **/ (root)**
   - **Save** 클릭

4. 몇 분 후 `https://사용자명.github.io/저장소명/`에서 접속 가능합니다.

## 관리자 설정

- 기본 관리자 비밀번호: `admin1234`
- 변경 방법: Google Sheets의 **"설정" 시트**에서 `adminPassword` 값을 수정

## 데모 모드

`config.js`의 `SCRIPT_URL`이 비어있으면 **데모 모드**로 동작합니다.
브라우저의 localStorage에 데이터가 저장되며, Google Sheets 없이도 기능을 테스트할 수 있습니다.

## 파일 구조

```
├── index.html          # 메인 예약 현황 페이지
├── admin.html          # 관리자 페이지
├── css/
│   └── style.css       # 스타일
├── js/
│   ├── config.js       # 설정 (룸, 시간대, API URL)
│   ├── app.js          # 메인 앱 로직
│   ├── api.js          # API 통신 모듈
│   └── admin.js        # 관리자 페이지 로직
├── gas/
│   └── Code.gs         # Google Apps Script 백엔드 코드
└── README.md
```

## 기술 스택

- **프론트엔드**: HTML, CSS, Vanilla JavaScript
- **백엔드**: Google Apps Script (무료)
- **데이터베이스**: Google Sheets (무료)
- **호스팅**: GitHub Pages (무료)
- **총 비용**: 0원
