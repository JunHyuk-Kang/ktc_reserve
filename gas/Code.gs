/**
 * 멘토링 예약 시스템 - Google Apps Script 백엔드
 *
 * 사용법:
 * 1. Google Sheets를 생성합니다.
 * 2. 확장 프로그램 > Apps Script를 클릭합니다.
 * 3. 이 코드를 전체 복사하여 Code.gs에 붙여넣습니다.
 * 4. 배포 > 새 배포 > 웹 앱 선택
 *    - 실행 권한: 본인
 *    - 액세스: 모든 사용자
 * 5. 배포 URL을 복사하여 config.js의 SCRIPT_URL에 입력합니다.
 *
 * 시트 구조:
 * - "예약" 시트: id | date | instructor | room | startTime | endTime | name | course | topic | people | password | createdAt
 * - "설정" 시트: key | value (adminPassword 등)
 * - "강사" 시트: name
 */

// === 설정 ===
const SHEET_NAME = '예약';
const SETTINGS_SHEET = '설정';
const INSTRUCTOR_SHEET = '강사';
const DEFAULT_ADMIN_PASSWORD = 'admin1234'; // 첫 실행 시 기본 관리자 비밀번호

// === 초기 설정 ===
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 예약 시트 생성
  let bookingSheet = ss.getSheetByName(SHEET_NAME);
  if (!bookingSheet) {
    bookingSheet = ss.insertSheet(SHEET_NAME);
    bookingSheet.appendRow(['id', 'date', 'instructor', 'room', 'startTime', 'endTime', 'name', 'course', 'topic', 'people', 'password', 'createdAt']);
    bookingSheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }

  // 설정 시트 생성
  let settingsSheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet(SETTINGS_SHEET);
    settingsSheet.appendRow(['key', 'value']);
    settingsSheet.appendRow(['adminPassword', DEFAULT_ADMIN_PASSWORD]);
    settingsSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }

  // 강사 시트 생성
  let instructorSheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  if (!instructorSheet) {
    instructorSheet = ss.insertSheet(INSTRUCTOR_SHEET);
    instructorSheet.appendRow(['name']);
    instructorSheet.getRange(1, 1, 1, 1).setFontWeight('bold');
  }
}

// === HTTP Handlers ===

function doGet(e) {
  const params = e.parameter;
  const action = params.action;

  let result;
  try {
    switch (action) {
      case 'getInstructors':
        result = { instructors: getInstructorList() };
        break;
      case 'getBookings':
        result = getBookings(params.date, params.instructor || '');
        break;
      case 'adminGetAll':
        result = adminGetAllBookings(params.password, parseInt(params.page) || 1, params.search || '');
        break;
      default:
        result = { error: '알 수 없는 액션입니다.' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: '잘못된 요청입니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const action = body.action;
  let result;

  try {
    switch (action) {
      case 'create':
        result = createBooking(body);
        break;
      case 'update':
        result = updateBooking(body);
        break;
      case 'delete':
        result = deleteBooking(body.id, body.password);
        break;
      case 'adminLogin':
        result = adminLogin(body.password);
        break;
      case 'adminDelete':
        result = adminDeleteBooking(body.id, body.adminPassword);
        break;
      case 'addInstructor':
        result = addInstructor(body.name, body.adminPassword);
        break;
      case 'updateInstructor':
        result = updateInstructor(body.oldName, body.newName, body.adminPassword);
        break;
      case 'deleteInstructor':
        result = deleteInstructor(body.name, body.adminPassword);
        break;
      default:
        result = { error: '알 수 없는 액션입니다.' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// === 예약 CRUD ===

function getBookings(date, instructor) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();
  // Columns: 0:id 1:date 2:instructor 3:room 4:startTime 5:endTime 6:name 7:course 8:topic 9:people 10:password 11:createdAt

  const bookings = [];
  const roomBlocks = []; // 다른 강사의 룸 사용 정보

  for (let i = 1; i < data.length; i++) {
    const rowDate = normalizeDate(data[i][1]);
    if (rowDate !== date) continue;

    const rowInstructor = normalizeStr(data[i][2]);
    const rowRoom = normalizeStr(data[i][3]);
    const rowStart = normalizeTime(data[i][4]);
    const rowEnd = normalizeTime(data[i][5]);

    if (!instructor || rowInstructor === instructor) {
      bookings.push({
        id: normalizeStr(data[i][0]),
        date: rowDate,
        instructor: rowInstructor,
        room: rowRoom,
        startTime: rowStart,
        endTime: rowEnd,
        name: normalizeStr(data[i][6]),
        course: normalizeStr(data[i][7]),
        topic: normalizeStr(data[i][8]),
        people: data[i][9],
        createdAt: normalizeStr(data[i][11]),
      });
    } else {
      // 다른 강사의 예약 → 룸 사용중 표시용
      roomBlocks.push({
        room: rowRoom,
        startTime: rowStart,
        endTime: rowEnd,
        instructor: rowInstructor,
      });
    }
  }

  return { bookings, roomBlocks };
}

function createBooking(body) {
  // 중복 예약 체크
  if (hasConflict(body.date, body.instructor, body.room, body.startTime, body.endTime)) {
    throw new Error('해당 시간에 이미 예약이 있습니다.');
  }

  const sheet = getBookingSheet();
  const id = Utilities.getUuid();
  const hashedPassword = hashPassword(body.password);
  const createdAt = new Date().toISOString();

  // appendRow 대신 setValues 사용 — Plain Text 포맷을 먼저 설정하여 자동 변환 방지
  const lastRow = sheet.getLastRow() + 1;
  const range = sheet.getRange(lastRow, 1, 1, 12);
  range.setNumberFormat('@');
  range.setValues([[
    id,
    body.date,
    body.instructor,
    body.room,
    body.startTime,
    body.endTime,
    body.name,
    body.course,
    body.topic,
    String(body.people),
    hashedPassword,
    createdAt,
  ]]);

  return {
    success: true,
    booking: {
      id, date: body.date, instructor: body.instructor, room: body.room,
      startTime: body.startTime, endTime: body.endTime,
      name: body.name, course: body.course, topic: body.topic,
      people: body.people, createdAt,
    },
  };
}

function updateBooking(body) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();
  // Columns: 0:id 1:date 2:instructor 3:room 4:startTime 5:endTime 6:name 7:course 8:topic 9:people 10:password 11:createdAt

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) === body.id) {
      // 비밀번호 확인
      if (!verifyPassword(body.password, data[i][10])) {
        throw new Error('비밀번호가 일치하지 않습니다.');
      }

      // 중복 예약 체크 (자기 자신 제외)
      if (hasConflict(body.date, body.instructor, body.room, body.startTime, body.endTime, body.id)) {
        throw new Error('해당 시간에 이미 예약이 있습니다.');
      }

      // 업데이트 (Plain Text 포맷으로 date/time 자동 변환 방지)
      const row = i + 1;
      sheet.getRange(row, 2).setNumberFormat('@').setValue(body.date);
      sheet.getRange(row, 3).setValue(body.instructor);
      sheet.getRange(row, 4).setValue(body.room);
      sheet.getRange(row, 5).setNumberFormat('@').setValue(body.startTime);
      sheet.getRange(row, 6).setNumberFormat('@').setValue(body.endTime);
      sheet.getRange(row, 7).setValue(body.name);
      sheet.getRange(row, 8).setValue(body.course);
      sheet.getRange(row, 9).setValue(body.topic);
      sheet.getRange(row, 10).setValue(body.people);

      return { success: true };
    }
  }

  throw new Error('예약을 찾을 수 없습니다.');
}

function deleteBooking(id, password) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) === id) {
      if (!verifyPassword(password, data[i][10])) {
        throw new Error('비밀번호가 일치하지 않습니다.');
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  throw new Error('예약을 찾을 수 없습니다.');
}

// === 중복 체크 ===

function hasConflict(date, instructor, room, startTime, endTime, excludeId) {
  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();
  // Columns: 0:id 1:date 2:instructor 3:room 4:startTime 5:endTime
  // 룸은 물리적 공간이므로 강사 무관하게 같은 룸/시간 충돌 체크

  for (let i = 1; i < data.length; i++) {
    if (excludeId && normalizeStr(data[i][0]) === excludeId) continue;
    if (normalizeDate(data[i][1]) === date && normalizeStr(data[i][3]) === room) {
      const existStart = normalizeTime(data[i][4]);
      const existEnd = normalizeTime(data[i][5]);
      if (startTime < existEnd && endTime > existStart) {
        return true;
      }
    }
  }

  return false;
}

// === 관리자 ===

function adminLogin(password) {
  const adminPw = getAdminPassword();
  if (password === adminPw) {
    return { success: true };
  }
  throw new Error('관리자 비밀번호가 올바르지 않습니다.');
}

function adminGetAllBookings(password, page, search) {
  const adminPw = getAdminPassword();
  if (password !== adminPw) {
    throw new Error('관리자 인증에 실패했습니다.');
  }

  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();
  let bookings = [];

  for (let i = 1; i < data.length; i++) {
    bookings.push({
      id: normalizeStr(data[i][0]),
      date: normalizeDate(data[i][1]),
      instructor: normalizeStr(data[i][2]),
      room: normalizeStr(data[i][3]),
      startTime: normalizeTime(data[i][4]),
      endTime: normalizeTime(data[i][5]),
      name: normalizeStr(data[i][6]),
      course: normalizeStr(data[i][7]),
      topic: normalizeStr(data[i][8]),
      people: data[i][9],
      createdAt: normalizeStr(data[i][11]),
    });
  }

  // 검색 필터
  if (search) {
    const q = search.toLowerCase();
    bookings = bookings.filter(b =>
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.topic && b.topic.toLowerCase().includes(q)) ||
      (b.room && b.room.toLowerCase().includes(q)) ||
      (b.instructor && b.instructor.toLowerCase().includes(q)) ||
      (b.course && b.course.includes(q))
    );
  }

  // 최신순 정렬
  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 페이지네이션
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

function adminDeleteBooking(id, adminPassword) {
  const adminPw = getAdminPassword();
  if (adminPassword !== adminPw) {
    throw new Error('관리자 인증에 실패했습니다.');
  }

  const sheet = getBookingSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normalizeStr(data[i][0]) === id) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  throw new Error('예약을 찾을 수 없습니다.');
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
    if (data[i][0]) names.push(data[i][0]);
  }
  return names;
}

function addInstructor(name, adminPassword) {
  const adminPw = getAdminPassword();
  if (adminPassword !== adminPw) throw new Error('관리자 인증에 실패했습니다.');
  if (!name || !name.trim()) throw new Error('강사명을 입력해주세요.');

  const trimmed = name.trim();
  const existing = getInstructorList();
  if (existing.includes(trimmed)) throw new Error('이미 존재하는 강사명입니다.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  sheet.appendRow([trimmed]);

  return { success: true };
}

function updateInstructor(oldName, newName, adminPassword) {
  const adminPw = getAdminPassword();
  if (adminPassword !== adminPw) throw new Error('관리자 인증에 실패했습니다.');
  if (!newName || !newName.trim()) throw new Error('새 강사명을 입력해주세요.');

  const trimmedNew = newName.trim();
  const existing = getInstructorList();
  if (oldName !== trimmedNew && existing.includes(trimmedNew)) throw new Error('이미 존재하는 강사명입니다.');

  // 강사 시트에서 이름 변경
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const instrSheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  const instrData = instrSheet.getDataRange().getValues();
  for (let i = 1; i < instrData.length; i++) {
    if (instrData[i][0] === oldName) {
      instrSheet.getRange(i + 1, 1).setValue(trimmedNew);
      break;
    }
  }

  // 기존 예약의 강사명도 일괄 변경
  const bookingSheet = getBookingSheet();
  const bookingData = bookingSheet.getDataRange().getValues();
  for (let i = 1; i < bookingData.length; i++) {
    if (bookingData[i][2] === oldName) {
      bookingSheet.getRange(i + 1, 3).setValue(trimmedNew);
    }
  }

  return { success: true };
}

function deleteInstructor(name, adminPassword) {
  const adminPw = getAdminPassword();
  if (adminPassword !== adminPw) throw new Error('관리자 인증에 실패했습니다.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INSTRUCTOR_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  throw new Error('강사를 찾을 수 없습니다.');
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

function getAdminPassword() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName(SETTINGS_SHEET);
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'adminPassword') {
      return data[i][1];
    }
  }

  return DEFAULT_ADMIN_PASSWORD;
}

function hashPassword(password) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return hash.map(b => ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join('');
}

function verifyPassword(inputPassword, storedHash) {
  const inputHash = hashPassword(inputPassword);
  return inputHash === storedHash;
}
