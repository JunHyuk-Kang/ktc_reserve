/**
 * 멘토링 예약 시스템 - Google Apps Script 백엔드 (v2)
 *
 * 사용법:
 * 1. Google Sheets를 생성합니다. (기존 시트가 있으면 그대로 사용)
 * 2. 확장 프로그램 > Apps Script를 클릭합니다.
 * 3. 이 코드를 전체 복사하여 Code.gs에 붙여넣습니다.
 * 4. 함수 선택에서 setup을 선택하고 실행합니다.
 *    (v1에서 업그레이드하는 경우에도 setup을 한 번 실행하면 email 컬럼/차단 시트/설정 값이 자동 추가됩니다)
 * 5. 배포 > 배포 관리 > 수정 > 새 버전으로 재배포합니다. (새 배포를 만들면 URL이 바뀌므로 주의)
 *
 * 시트 구조:
 * - "예약" 시트: id | date | instructor | room | startTime | endTime | name | course | topic | people | password | createdAt | email
 * - "설정" 시트: key | value (adminPassword, rooms, startHour, endHour, slotMinutes)
 * - "강사" 시트: name
 * - "차단" 시트: id | date | room | startTime | endTime | reason | createdAt
 */

// === 설정 ===
const SHEET_NAME = '예약';
const SETTINGS_SHEET = '설정';
const INSTRUCTOR_SHEET = '강사';
const BLOCK_SHEET = '차단';
const DEFAULT_ADMIN_PASSWORD = 'admin1234'; // 첫 실행 시 기본 관리자 비밀번호

const BOOKING_HEADER = ['id', 'date', 'instructor', 'room', 'startTime', 'endTime', 'name', 'course', 'topic', 'people', 'password', 'createdAt', 'email'];
const BLOCK_HEADER = ['id', 'date', 'room', 'startTime', 'endTime', 'reason', 'createdAt'];

const ADMIN_TOKEN_TTL = 21600; // 관리자 세션 토큰 유효 시간 (초, CacheService 최대값 = 6시간)
const DAY_CACHE_TTL = 120;     // 날짜별 예약 데이터 캐시 (초)

// === 초기 설정 (v1 → v2 마이그레이션 포함) ===
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 예약 시트
  let bookingSheet = ss.getSheetByName(SHEET_NAME);
  if (!bookingSheet) {
    bookingSheet = ss.insertSheet(SHEET_NAME);
    bookingSheet.appendRow(BOOKING_HEADER);
    bookingSheet.getRange(1, 1, 1, BOOKING_HEADER.length).setFontWeight('bold');
  } else if (bookingSheet.getRange(1, BOOKING_HEADER.length).getValue() !== 'email') {
    // v1(12컬럼) → v2: email 컬럼 헤더 추가
    bookingSheet.getRange(1, BOOKING_HEADER.length).setValue('email').setFontWeight('bold');
  }

  // 설정 시트 (없는 키만 채워넣음)
  let settingsSheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet(SETTINGS_SHEET);
    settingsSheet.appendRow(['key', 'value']);
    settingsSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  const defaults = {
    adminPassword: DEFAULT_ADMIN_PASSWORD,
    rooms: '멘토링룸 1,멘토링룸 2,멘토링룸 3,멘토링룸 4,멘토링룸 5,멘토링룸 6,멘토링룸 7,멘토링룸 8,멘토링룸 9,멘토링룸 10',
    startHour: '9',
    endHour: '22',
    slotMinutes: '30',
  };
  const existing = getSettingsMap();
  Object.keys(defaults).forEach(key => {
    if (!(key in existing)) settingsSheet.appendRow([key, defaults[key]]);
  });

  // 강사 시트
  let instructorSheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  if (!instructorSheet) {
    instructorSheet = ss.insertSheet(INSTRUCTOR_SHEET);
    instructorSheet.appendRow(['name']);
    instructorSheet.getRange(1, 1, 1, 1).setFontWeight('bold');
  }

  // 차단 시트
  let blockSheet = ss.getSheetByName(BLOCK_SHEET);
  if (!blockSheet) {
    blockSheet = ss.insertSheet(BLOCK_SHEET);
    blockSheet.appendRow(BLOCK_HEADER);
    blockSheet.getRange(1, 1, 1, BLOCK_HEADER.length).setFontWeight('bold');
  }
}

// === HTTP Handlers ===

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;

  let result;
  try {
    switch (action) {
      case 'getInit':
        result = {
          config: getPublicConfig(),
          instructors: getInstructorList(),
          ...getBookings(params.date, params.instructor || ''),
        };
        break;
      case 'getInstructors':
        result = { instructors: getInstructorList() };
        break;
      case 'getBookings':
        result = getBookings(params.date, params.instructor || '');
        break;
      case 'getWeek':
        result = getWeek(params.start, params.instructor || '');
        break;
      default:
        result = { error: '알 수 없는 액션입니다.' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return jsonOutput(result);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ error: '잘못된 요청입니다.' });
  }

  const action = body.action;
  let result;

  try {
    switch (action) {
      // --- 사용자 ---
      case 'create':
        result = withLock(() => createBooking(body));
        break;
      case 'update':
        result = withLock(() => updateBooking(body));
        break;
      case 'delete':
        result = withLock(() => deleteBooking(body.id, body.password));
        break;
      case 'getMyBookings':
        result = getMyBookings(body.name, body.password);
        break;
      // --- 관리자 ---
      case 'adminLogin':
        result = adminLogin(body.password);
        break;
      case 'adminInit':
        requireAdmin(body.token);
        result = {
          config: getPublicConfig(),
          instructors: getInstructorList(),
          stats: computeStats(),
          blocks: getAllBlocks(),
        };
        break;
      case 'adminGetAll':
        requireAdmin(body.token);
        result = adminGetAllBookings(parseInt(body.page, 10) || 1, body.search || '');
        break;
      case 'adminDelete':
        requireAdmin(body.token);
        result = withLock(() => adminDeleteBooking(body.id));
        break;
      case 'adminExport':
        requireAdmin(body.token);
        result = adminExportBookings();
        break;
      case 'adminStats':
        requireAdmin(body.token);
        result = { stats: computeStats() };
        break;
      case 'addInstructor':
        requireAdmin(body.token);
        result = withLock(() => addInstructor(body.name));
        break;
      case 'updateInstructor':
        requireAdmin(body.token);
        result = withLock(() => updateInstructor(body.oldName, body.newName));
        break;
      case 'deleteInstructor':
        requireAdmin(body.token);
        result = withLock(() => deleteInstructor(body.name, body.force === true));
        break;
      case 'addBlock':
        requireAdmin(body.token);
        result = withLock(() => addBlock(body));
        break;
      case 'deleteBlock':
        requireAdmin(body.token);
        result = withLock(() => deleteBlock(body.id));
        break;
      default:
        result = { error: '알 수 없는 액션입니다.' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return jsonOutput(result);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// === 동시성 제어 ===

function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// === 관리자 인증 (세션 토큰) ===

function adminLogin(password) {
  const adminPw = getSetting('adminPassword', DEFAULT_ADMIN_PASSWORD);
  if (String(password) !== String(adminPw)) {
    throw new Error('관리자 비밀번호가 올바르지 않습니다.');
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('admtok_' + token, '1', ADMIN_TOKEN_TTL);
  return { success: true, token };
}

function requireAdmin(token) {
  const cache = CacheService.getScriptCache();
  if (!token || !cache.get('admtok_' + token)) {
    throw new Error('관리자 인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  // 활동 시마다 토큰 수명 연장
  cache.put('admtok_' + token, '1', ADMIN_TOKEN_TTL);
}

// === 날짜별 데이터 캐시 ===

function dayCacheKey(date) {
  return 'day_' + date;
}

function invalidateDays(dates) {
  const keys = [];
  dates.forEach(d => { if (d) keys.push(dayCacheKey(d)); });
  if (keys.length) CacheService.getScriptCache().removeAll(keys);
}

/**
 * 여러 날짜의 예약/차단 데이터를 시트 1회 스캔으로 조회 (날짜별 캐시 사용)
 * 반환: { 'yyyy-MM-dd': { bookings: [...], blocks: [...] } }
 */
function getDayDataBulk(dates) {
  const cache = CacheService.getScriptCache();
  const result = {};
  const missing = [];

  dates.forEach(d => {
    const hit = cache.get(dayCacheKey(d));
    if (hit) {
      result[d] = JSON.parse(hit);
    } else {
      missing.push(d);
    }
  });

  if (missing.length > 0) {
    const want = {};
    missing.forEach(d => {
      want[d] = true;
      result[d] = { bookings: [], blocks: [] };
    });

    const data = getBookingSheet().getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const d = normalizeDate(data[i][1]);
      if (!want[d]) continue;
      result[d].bookings.push(rowToBooking(data[i]));
    }

    const blockData = getBlockSheet().getDataRange().getValues();
    for (let i = 1; i < blockData.length; i++) {
      const d = normalizeDate(blockData[i][1]);
      if (!want[d]) continue;
      result[d].blocks.push(rowToBlock(blockData[i]));
    }

    const toCache = {};
    missing.forEach(d => { toCache[dayCacheKey(d)] = JSON.stringify(result[d]); });
    cache.putAll(toCache, DAY_CACHE_TTL);
  }

  return result;
}

// password/email은 공개 응답에 포함하지 않음
function rowToBooking(row) {
  return {
    id: normalizeStr(row[0]),
    date: normalizeDate(row[1]),
    instructor: normalizeStr(row[2]),
    room: normalizeStr(row[3]),
    startTime: normalizeTime(row[4]),
    endTime: normalizeTime(row[5]),
    name: normalizeStr(row[6]),
    course: normalizeStr(row[7]),
    topic: normalizeStr(row[8]),
    people: normalizeStr(row[9]),
    createdAt: normalizeStr(row[11]),
  };
}

function rowToBlock(row) {
  return {
    id: normalizeStr(row[0]),
    date: normalizeDate(row[1]),
    room: normalizeStr(row[2]),
    startTime: normalizeTime(row[3]),
    endTime: normalizeTime(row[4]),
    reason: normalizeStr(row[5]),
  };
}

// === 예약 조회 ===

function getBookings(date, instructor) {
  if (!date) throw new Error('날짜가 필요합니다.');
  const day = getDayDataBulk([date])[date];

  const bookings = [];
  const roomBlocks = [];

  day.bookings.forEach(b => {
    if (!instructor || b.instructor === instructor) {
      bookings.push(b);
    } else {
      // 다른 강사의 예약 → 룸 사용중 표시용
      roomBlocks.push({
        room: b.room, startTime: b.startTime, endTime: b.endTime,
        instructor: b.instructor, type: 'booking',
      });
    }
  });

  // 관리자 룸 차단
  day.blocks.forEach(bl => {
    roomBlocks.push({
      room: bl.room, startTime: bl.startTime, endTime: bl.endTime,
      reason: bl.reason, type: 'unavailable',
    });
  });

  return { bookings, roomBlocks };
}

// 주간 뷰: start(월요일)부터 7일치, 선택 강사의 예약만
function getWeek(start, instructor) {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('시작 날짜가 올바르지 않습니다.');
  const parts = start.split('-').map(Number);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(parts[0], parts[1] - 1, parts[2] + i);
    dates.push(Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  }

  const bulk = getDayDataBulk(dates);
  const days = dates.map(date => ({
    date,
    bookings: bulk[date].bookings.filter(b => !instructor || b.instructor === instructor),
  }));

  return { days };
}

// === 예약 CRUD ===

function validateBookingInput(body) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw new Error('날짜 형식이 올바르지 않습니다.');
  if (!/^\d{2}:\d{2}$/.test(String(body.startTime)) || !/^\d{2}:\d{2}$/.test(String(body.endTime))) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }
  if (String(body.startTime) >= String(body.endTime)) throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
  if (!body.instructor) throw new Error('강사를 선택해주세요.');
  if (!body.room) throw new Error('룸을 선택해주세요.');
  if (!body.name || !String(body.name).trim()) throw new Error('예약자 이름을 입력해주세요.');
  if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))) {
    throw new Error('이메일 형식이 올바르지 않습니다.');
  }
}

function createBooking(body) {
  validateBookingInput(body);
  if (!body.password || String(body.password).length < 4) {
    throw new Error('비밀번호는 4자 이상이어야 합니다.');
  }

  if (hasConflict(body.date, body.room, body.startTime, body.endTime)) {
    throw new Error('해당 시간에 이미 예약이 있거나 사용이 차단된 룸입니다.');
  }

  const sheet = getBookingSheet();
  const id = Utilities.getUuid();
  const hashedPassword = hashPassword(body.password);
  const createdAt = new Date().toISOString();

  // appendRow 대신 setValues 사용 — Plain Text 포맷을 먼저 설정하여 자동 변환 방지
  const lastRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(lastRow, 1, 1, BOOKING_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([[
    id, body.date, body.instructor, body.room,
    body.startTime, body.endTime,
    String(body.name).trim(), body.course || '', body.topic || '', String(body.people || '1'),
    hashedPassword, createdAt, body.email || '',
  ]]);

  invalidateDays([body.date]);

  const booking = {
    id, date: body.date, instructor: body.instructor, room: body.room,
    startTime: body.startTime, endTime: body.endTime,
    name: String(body.name).trim(), course: body.course, topic: body.topic,
    people: body.people, createdAt,
  };

  sendBookingEmail(body.email, booking, 'created');

  return { success: true, booking };
}

function updateBooking(body) {
  validateBookingInput(body);

  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) !== body.id) continue;

    if (!verifyPassword(body.password, data[i][10])) {
      throw new Error('비밀번호가 일치하지 않습니다.');
    }

    if (hasConflict(body.date, body.room, body.startTime, body.endTime, body.id)) {
      throw new Error('해당 시간에 이미 예약이 있거나 사용이 차단된 룸입니다.');
    }

    const oldDate = normalizeDate(data[i][1]);
    const row = i + 1;
    sheet.getRange(row, 2).setNumberFormat('@').setValue(body.date);
    sheet.getRange(row, 3).setValue(body.instructor);
    sheet.getRange(row, 4).setValue(body.room);
    sheet.getRange(row, 5).setNumberFormat('@').setValue(body.startTime);
    sheet.getRange(row, 6).setNumberFormat('@').setValue(body.endTime);
    sheet.getRange(row, 7).setValue(String(body.name).trim());
    sheet.getRange(row, 8).setValue(body.course || '');
    sheet.getRange(row, 9).setValue(body.topic || '');
    sheet.getRange(row, 10).setValue(String(body.people || '1'));
    sheet.getRange(row, 13).setNumberFormat('@').setValue(body.email || '');

    invalidateDays([oldDate, body.date]);
    return { success: true };
  }

  throw new Error('예약을 찾을 수 없습니다.');
}

function deleteBooking(id, password) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) !== id) continue;

    if (!verifyPassword(password, data[i][10])) {
      throw new Error('비밀번호가 일치하지 않습니다.');
    }

    const booking = rowToBooking(data[i]);
    const email = normalizeStr(data[i][12]);
    sheet.deleteRow(i + 1);
    invalidateDays([booking.date]);
    sendBookingEmail(email, booking, 'cancelled');
    return { success: true };
  }

  throw new Error('예약을 찾을 수 없습니다.');
}

// === 내 예약 조회 (이름 + 비밀번호) ===

function getMyBookings(name, password) {
  if (!name || !password) throw new Error('이름과 비밀번호를 입력해주세요.');

  const trimmed = String(name).trim();
  const data = getBookingSheet().getDataRange().getValues();
  const bookings = [];

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][6]) !== trimmed) continue;
    if (!verifyPassword(password, data[i][10])) continue;
    bookings.push(rowToBooking(data[i]));
    if (bookings.length >= 100) break;
  }

  // 다가오는 예약 먼저, 같은 날짜는 시작 시간순
  bookings.sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));

  return { bookings };
}

// === 중복/차단 체크 ===

function hasConflict(date, room, startTime, endTime, excludeId) {
  // 룸은 물리적 공간이므로 강사 무관하게 같은 룸/시간 충돌 체크
  const data = getBookingSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (excludeId && normalizeStr(data[i][0]) === excludeId) continue;
    if (normalizeDate(data[i][1]) === date && normalizeStr(data[i][3]) === room) {
      const existStart = normalizeTime(data[i][4]);
      const existEnd = normalizeTime(data[i][5]);
      if (startTime < existEnd && endTime > existStart) return true;
    }
  }

  // 관리자 룸 차단과의 충돌
  const blockData = getBlockSheet().getDataRange().getValues();
  for (let i = 1; i < blockData.length; i++) {
    if (normalizeDate(blockData[i][1]) === date && normalizeStr(blockData[i][2]) === room) {
      const bStart = normalizeTime(blockData[i][3]);
      const bEnd = normalizeTime(blockData[i][4]);
      if (startTime < bEnd && endTime > bStart) return true;
    }
  }

  return false;
}

// === 관리자: 예약 관리 ===

function adminGetAllBookings(page, search) {
  const data = getBookingSheet().getDataRange().getValues();
  let bookings = [];

  for (let i = 1; i < data.length; i++) {
    bookings.push(rowToBooking(data[i]));
  }

  if (search) {
    const q = String(search).toLowerCase();
    bookings = bookings.filter(b =>
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.topic && b.topic.toLowerCase().includes(q)) ||
      (b.room && b.room.toLowerCase().includes(q)) ||
      (b.instructor && b.instructor.toLowerCase().includes(q)) ||
      (b.course && b.course.toLowerCase().includes(q))
    );
  }

  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const pageSize = 20;
  const total = bookings.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;

  return {
    bookings: bookings.slice(start, start + pageSize),
    total,
    totalPages,
    currentPage: page,
  };
}

function adminDeleteBooking(id) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) === id) {
      const booking = rowToBooking(data[i]);
      const email = normalizeStr(data[i][12]);
      sheet.deleteRow(i + 1);
      invalidateDays([booking.date]);
      sendBookingEmail(email, booking, 'cancelled');
      return { success: true };
    }
  }

  throw new Error('예약을 찾을 수 없습니다.');
}

// CSV 내보내기용 전체 데이터 (이메일 포함, 비밀번호 제외)
function adminExportBookings() {
  const data = getBookingSheet().getDataRange().getValues();
  const bookings = [];

  for (let i = 1; i < data.length; i++) {
    const b = rowToBooking(data[i]);
    b.email = normalizeStr(data[i][12]);
    bookings.push(b);
  }

  bookings.sort((a, b) => (a.date + a.startTime > b.date + b.startTime ? 1 : -1));
  return { bookings };
}

// === 관리자: 통계 ===

function computeStats() {
  const data = getBookingSheet().getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  let total = 0;
  let upcoming = 0;
  let todayCount = 0;
  let totalMinutes = 0;
  const byInstructor = {};
  const byRoom = {};
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]; // 0 = 일요일
  const byHour = {};

  for (let i = 1; i < data.length; i++) {
    const date = normalizeDate(data[i][1]);
    const instructor = normalizeStr(data[i][2]);
    const room = normalizeStr(data[i][3]);
    const startTime = normalizeTime(data[i][4]);
    const endTime = normalizeTime(data[i][5]);

    total++;
    if (date >= today) upcoming++;
    if (date === today) todayCount++;

    byInstructor[instructor] = (byInstructor[instructor] || 0) + 1;
    byRoom[room] = (byRoom[room] || 0) + 1;

    const parts = date.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0])) {
      byWeekday[new Date(parts[0], parts[1] - 1, parts[2]).getDay()]++;
    }

    const startHour = parseInt(startTime, 10);
    if (!isNaN(startHour)) byHour[startHour] = (byHour[startHour] || 0) + 1;

    const mins = timeToMinutes(endTime) - timeToMinutes(startTime);
    if (mins > 0) totalMinutes += mins;
  }

  return { total, upcoming, todayCount, totalHours: Math.round(totalMinutes / 60), byInstructor, byRoom, byWeekday, byHour };
}

function timeToMinutes(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// === 강사 관리 ===

function getInstructorList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  }
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) names.push(String(data[i][0]));
  }
  return names;
}

function addInstructor(name) {
  if (!name || !String(name).trim()) throw new Error('강사명을 입력해주세요.');

  const trimmed = String(name).trim();
  if (getInstructorList().includes(trimmed)) throw new Error('이미 존재하는 강사명입니다.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheetByName(INSTRUCTOR_SHEET).appendRow([trimmed]);

  return { success: true };
}

function updateInstructor(oldName, newName) {
  if (!newName || !String(newName).trim()) throw new Error('새 강사명을 입력해주세요.');

  const trimmedNew = String(newName).trim();
  const existing = getInstructorList();
  if (oldName !== trimmedNew && existing.includes(trimmedNew)) throw new Error('이미 존재하는 강사명입니다.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instrSheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  const instrData = instrSheet.getDataRange().getValues();
  for (let i = 1; i < instrData.length; i++) {
    if (String(instrData[i][0]) === oldName) {
      instrSheet.getRange(i + 1, 1).setValue(trimmedNew);
      break;
    }
  }

  // 기존 예약의 강사명도 일괄 변경 + 해당 날짜 캐시 무효화
  const bookingSheet = getBookingSheet();
  const bookingData = bookingSheet.getDataRange().getValues();
  const affectedDates = {};
  for (let i = 1; i < bookingData.length; i++) {
    if (normalizeStr(bookingData[i][2]) === oldName) {
      bookingSheet.getRange(i + 1, 3).setValue(trimmedNew);
      affectedDates[normalizeDate(bookingData[i][1])] = true;
    }
  }
  invalidateDays(Object.keys(affectedDates));

  return { success: true };
}

function deleteInstructor(name, force) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === name) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('강사를 찾을 수 없습니다.');

  // 예정된 예약이 있으면 확인 요청 (force=true일 때만 삭제 진행)
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const bookingData = getBookingSheet().getDataRange().getValues();
  let futureCount = 0;
  for (let i = 1; i < bookingData.length; i++) {
    if (normalizeStr(bookingData[i][2]) === name && normalizeDate(bookingData[i][1]) >= today) {
      futureCount++;
    }
  }

  if (futureCount > 0 && !force) {
    return { needsConfirm: true, futureCount };
  }

  sheet.deleteRow(rowIndex);
  return { success: true, futureCount };
}

// === 룸 차단 관리 ===

function getAllBlocks() {
  const data = getBlockSheet().getDataRange().getValues();
  const blocks = [];
  for (let i = 1; i < data.length; i++) {
    blocks.push(rowToBlock(data[i]));
  }
  blocks.sort((a, b) => (a.date + a.startTime > b.date + b.startTime ? 1 : -1));
  return blocks;
}

function addBlock(body) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw new Error('날짜 형식이 올바르지 않습니다.');
  if (!/^\d{2}:\d{2}$/.test(String(body.startTime)) || !/^\d{2}:\d{2}$/.test(String(body.endTime))) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }
  if (String(body.startTime) >= String(body.endTime)) throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
  if (!body.room) throw new Error('룸을 선택해주세요.');

  const sheet = getBlockSheet();
  const id = Utilities.getUuid();
  const lastRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(lastRow, 1, 1, BLOCK_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([[
    id, body.date, body.room, body.startTime, body.endTime,
    body.reason || '', new Date().toISOString(),
  ]]);

  invalidateDays([body.date]);
  return { success: true, blocks: getAllBlocks() };
}

function deleteBlock(id) {
  const sheet = getBlockSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) === id) {
      const date = normalizeDate(data[i][1]);
      sheet.deleteRow(i + 1);
      invalidateDays([date]);
      return { success: true, blocks: getAllBlocks() };
    }
  }

  throw new Error('차단 항목을 찾을 수 없습니다.');
}

// === 이메일 알림 (선택 입력, 실패해도 예약 처리에는 영향 없음) ===

function sendBookingEmail(email, booking, kind) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return;

  const isCreated = kind === 'created';
  const subject = (isCreated ? '[멘토링 예약 확인] ' : '[멘토링 예약 취소] ')
    + booking.date + ' ' + booking.startTime + '~' + booking.endTime + ' ' + booking.room;
  const lines = [
    isCreated ? '멘토링 예약이 완료되었습니다.' : '멘토링 예약이 취소되었습니다.',
    '',
    '- 날짜: ' + booking.date,
    '- 시간: ' + booking.startTime + ' ~ ' + booking.endTime,
    '- 룸: ' + booking.room,
    '- 강사: ' + booking.instructor,
    '- 예약자: ' + booking.name,
    '- 과정명: ' + (booking.course || '-'),
    '- 주제: ' + (booking.topic || '-'),
  ];

  try {
    MailApp.sendEmail(String(email), subject, lines.join('\n'));
  } catch (e) {
    // 메일 발송 실패(쿼터 초과 등)는 무시
  }
}

// === 설정 ===

function getSettingsMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  const map = {};
  if (!sheet) return map;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) map[String(data[i][0])] = data[i][1];
  }
  return map;
}

function getSetting(key, fallback) {
  const map = getSettingsMap();
  return key in map ? map[key] : fallback;
}

// 프론트엔드에 내려줄 공개 설정 (룸/운영시간 — "설정" 시트에서 수정 가능)
function getPublicConfig() {
  const s = getSettingsMap();
  const rooms = String(s.rooms || '').split(',').map(r => r.trim()).filter(Boolean);
  return {
    rooms,
    startHour: parseInt(s.startHour, 10) || 9,
    endHour: parseInt(s.endHour, 10) || 22,
    slotMinutes: parseInt(s.slotMinutes, 10) || 30,
  };
}

// === 값 정규화 (Google Sheets 자동 변환 대응) ===

function normalizeDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

function normalizeTime(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(val);
}

function normalizeStr(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

// === 유틸리티 ===

function getBookingSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName(SHEET_NAME);
  }
  return sheet;
}

function getBlockSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BLOCK_SHEET);
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName(BLOCK_SHEET);
  }
  return sheet;
}

function hashPassword(password) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password));
  return hash.map(b => ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join('');
}

function verifyPassword(inputPassword, storedHash) {
  return hashPassword(inputPassword) === String(storedHash);
}
