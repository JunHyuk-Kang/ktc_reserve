const CONFIG = {
  // === 기본 설정 ===
  title: '멘토링 예약 시스템',
  subtitle: 'KTC 멘토링',

  // === 강사 목록 (자유롭게 추가/삭제 가능) ===
  instructors: [
    '김멘토',
    '이멘토',
    '박멘토',
  ],

  // === 룸 설정 (자유롭게 추가/삭제 가능) ===
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

  // === 시간 설정 ===
  startHour: 9,      // 시작 시간 (24시간 형식)
  endHour: 22,       // 종료 시간 (24시간 형식)
  slotMinutes: 30,   // 슬롯 단위 (분)

  // === Google Apps Script 배포 URL ===
  // Google Sheets에서 Apps Script 배포 후 여기에 URL을 입력하세요
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwPJf02a2iKWKuvBEYLqxAGONEDUeho6MpS0yg1gJPlz4NB7Jowrezj7ySoNQo8wgZJ1A/exec',

  // === 관리자 비밀번호 (GAS 측에서도 검증) ===
  // 실제 인증은 서버(GAS)에서 처리됩니다
};
