const CONFIG = {
  // === 기본 설정 ===
  title: '멘토링 예약 시스템',
  subtitle: 'KTC 멘토링',

  // === 강사 목록 ===
  // 실제 강사 목록은 Google Sheets의 "강사" 시트에서 관리됩니다.
  // 아래 값은 데모 모드(SCRIPT_URL 미설정)의 초기값으로만 사용됩니다.
  instructors: [
    '김멘토',
    '이멘토',
    '박멘토',
  ],

  // === 룸 / 시간 설정 (서버 연결 시 "설정" 시트 값이 우선 적용됨) ===
  // GAS 연결 상태에서는 Google Sheets "설정" 시트의 rooms / startHour / endHour / slotMinutes
  // 값이 로딩 시 이 값을 덮어씁니다. 아래는 데모 모드용 + 로딩 전 기본값입니다.
  rooms: [
    '멘토링룸 1',
    '멘토링룸 2',
    '멘토링룸 3',
    '멘토링룸 4',
    '멘토링룸 5',
    '멘토링룸 6',
    '멘토링룸 7',
    '멘토링룸 8',
    '멘토링룸 9',
    '멘토링룸 10',
  ],
  startHour: 9,      // 시작 시간 (24시간 형식)
  endHour: 22,       // 종료 시간 (24시간 형식)
  slotMinutes: 30,   // 슬롯 단위 (분)

  // === Google Apps Script 배포 URL ===
  // 비워두면 데모 모드(localStorage)로 동작합니다
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwPJf02a2iKWKuvBEYLqxAGONEDUeho6MpS0yg1gJPlz4NB7Jowrezj7ySoNQo8wgZJ1A/exec',
};
