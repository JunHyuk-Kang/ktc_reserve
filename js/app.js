/**
 * 멘토링 예약 시스템 - 메인 앱 로직
 * - 포인터 이벤트 기반: 데스크톱은 드래그, 터치는 시작/종료 슬롯 2탭으로 선택
 * - 사용자 데이터는 innerHTML에 직접 넣지 않고 escape 처리 (인라인 핸들러 없음)
 */
(function () {
  // === State ===
  let currentDate = new Date();
  let currentInstructor = '';
  let currentView = 'day';        // 'day' | 'week'
  let bookings = [];              // day 뷰 데이터
  let roomBlocks = [];
  let weekDays = [];              // week 뷰 데이터 [{date, bookings}]
  let selectedSlots = [];
  let isDragging = false;
  let dragStartSlot = null;
  let touchTapStart = null;       // 터치 탭 판정용 {x, y}
  let touchAnchor = null;         // 터치 2탭 선택의 시작 셀
  let currentBookingId = null;
  let pendingAction = null;
  let modalContext = null;        // 예약 모달의 컨텍스트 {room, date, instructor}
  let myCreds = null;             // 내 예약 조회에 사용한 {name, password}

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // === Init ===
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    document.getElementById('sidebar-title').textContent = CONFIG.subtitle || CONFIG.title;
    document.title = CONFIG.title;

    // 캐시된 서버 설정/강사 목록으로 즉시 렌더 (재방문 시 빠른 표시)
    const cachedConfig = API.getCachedConfig && API.getCachedConfig();
    if (cachedConfig) applyServerConfig(cachedConfig);
    const cachedInstructors = API.getCachedInstructors();
    if (cachedInstructors && cachedInstructors.length > 0) {
      populateInstructorSelect(cachedInstructors);
    }

    currentDate = new Date();
    document.getElementById('date-picker').value = formatDate(currentDate);
    bindEvents();
    renderSkeleton();

    try {
      const requested = currentInstructor;
      const data = await API.getInit(formatDate(currentDate), requested);
      if (data.config) applyServerConfig(data.config);
      populateInstructorSelect(data.instructors);

      if (currentInstructor !== requested) {
        // 강사 미지정으로 요청한 최초 방문: 전체 예약이 섞여 오므로 선택된 강사 기준으로 분리
        const all = data.bookings || [];
        bookings = all.filter(b => b.instructor === currentInstructor);
        roomBlocks = (data.roomBlocks || []).concat(
          all.filter(b => b.instructor !== currentInstructor).map(b => ({
            room: b.room, startTime: b.startTime, endTime: b.endTime,
            instructor: b.instructor, type: 'booking',
          }))
        );
      } else {
        bookings = data.bookings || [];
        roomBlocks = data.roomBlocks || [];
      }
      renderGrid();
    } catch (err) {
      renderLoadError();
      showToast('데이터를 불러오는데 실패했습니다.', 'error');
      console.error(err);
    }
  }

  // 서버("설정" 시트) 값으로 룸/운영시간 덮어쓰기
  function applyServerConfig(cfg) {
    if (!cfg) return;
    if (Array.isArray(cfg.rooms) && cfg.rooms.length > 0) CONFIG.rooms = cfg.rooms;
    if (cfg.startHour) CONFIG.startHour = cfg.startHour;
    if (cfg.endHour) CONFIG.endHour = cfg.endHour;
    if (cfg.slotMinutes) CONFIG.slotMinutes = cfg.slotMinutes;
  }

  function bindEvents() {
    // 날짜 이동
    document.getElementById('btn-prev').addEventListener('click', () => navigateDate(-1));
    document.getElementById('btn-next').addEventListener('click', () => navigateDate(1));
    document.getElementById('btn-today').addEventListener('click', () => setDate(new Date()));
    document.getElementById('date-picker').addEventListener('change', (e) => {
      if (e.target.value) setDate(parseDate(e.target.value));
    });

    // 뷰 전환
    document.getElementById('btn-view-day').addEventListener('click', () => setView('day'));
    document.getElementById('btn-view-week').addEventListener('click', () => setView('week'));

    // 내 예약
    document.getElementById('btn-my-bookings').addEventListener('click', openMyBookingsModal);
    document.getElementById('btn-my-search').addEventListener('click', handleMySearch);
    document.getElementById('input-my-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleMySearch();
    });
    document.getElementById('my-bookings-list').addEventListener('click', handleMyBookingsListClick);

    // 예약 폼
    document.getElementById('btn-submit-booking').addEventListener('click', handleBookingSubmit);

    // 상세 모달 액션
    document.getElementById('btn-delete-booking').addEventListener('click', () => {
      pendingAction = 'delete';
      document.getElementById('password-modal-title').textContent = '삭제 확인';
      document.getElementById('input-confirm-password').value = '';
      openModal('modal-password');
    });
    document.getElementById('btn-edit-booking').addEventListener('click', () => {
      pendingAction = 'edit';
      document.getElementById('password-modal-title').textContent = '수정 확인';
      document.getElementById('input-confirm-password').value = '';
      openModal('modal-password');
    });

    document.getElementById('btn-confirm-password').addEventListener('click', handlePasswordConfirm);
    document.getElementById('input-confirm-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePasswordConfirm();
    });

    // 모달 공통 닫기
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
      }
    });

    // 그리드 상호작용 (이벤트 위임)
    const container = document.getElementById('schedule-container');
    container.addEventListener('pointerdown', onGridPointerDown);
    container.addEventListener('pointerover', onGridPointerOver);
    container.addEventListener('click', onGridClick);
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', () => { touchTapStart = null; });
  }

  // === Instructor Selector ===
  let instructorSelectBound = false;

  function populateInstructorSelect(instructors) {
    const select = document.getElementById('instructor-select');
    if (!select || !instructors || instructors.length === 0) return;

    const prevValue = currentInstructor;
    select.innerHTML = '';
    instructors.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    if (prevValue && instructors.includes(prevValue)) {
      currentInstructor = prevValue;
    } else {
      currentInstructor = instructors[0] || '';
    }
    select.value = currentInstructor;

    if (!instructorSelectBound) {
      select.addEventListener('change', (e) => {
        currentInstructor = e.target.value;
        loadCurrentView();
      });
      instructorSelectBound = true;
    }
  }

  // === Date Management ===
  function setDate(date) {
    currentDate = date;
    document.getElementById('date-picker').value = formatDate(date);
    loadCurrentView();
  }

  function navigateDate(delta) {
    const step = currentView === 'week' ? delta * 7 : delta;
    const d = new Date(currentDate);
    d.setDate(d.getDate() + step);
    setDate(d);
  }

  function setView(view) {
    if (currentView === view) return;
    currentView = view;
    document.getElementById('btn-view-day').classList.toggle('active', view === 'day');
    document.getElementById('btn-view-week').classList.toggle('active', view === 'week');
    loadCurrentView();
  }

  function loadCurrentView() {
    clearSelection();
    if (currentView === 'week') {
      loadWeek();
    } else {
      loadBookings();
    }
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 'yyyy-MM-dd' → Date (타임존 이슈 방지)
  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function weekStartOf(date) {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일 시작
    return d;
  }

  // === Time Slots ===
  function getTimeSlots() {
    const slots = [];
    const totalMinutes = (CONFIG.endHour - CONFIG.startHour) * 60;
    for (let m = 0; m < totalMinutes; m += CONFIG.slotMinutes) {
      const hour = CONFIG.startHour + Math.floor(m / 60);
      const min = m % 60;
      slots.push({
        time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      });
    }
    return slots;
  }

  function endHourStr() {
    return `${String(CONFIG.endHour).padStart(2, '0')}:00`;
  }

  // === Load ===
  async function loadBookings() {
    renderSkeleton();
    try {
      const result = await API.getBookings(formatDate(currentDate), currentInstructor);
      bookings = result.bookings || [];
      roomBlocks = result.roomBlocks || [];
      renderGrid();
    } catch (err) {
      renderLoadError();
      showToast('데이터를 불러오는데 실패했습니다.', 'error');
      console.error(err);
    }
  }

  async function loadWeek() {
    renderSkeleton();
    try {
      const start = formatDate(weekStartOf(currentDate));
      const result = await API.getWeek(start, currentInstructor);
      weekDays = result.days || [];
      renderWeekGrid();
    } catch (err) {
      renderLoadError();
      showToast('데이터를 불러오는데 실패했습니다.', 'error');
      console.error(err);
    }
  }

  // === Day Grid Render ===
  function renderGrid() {
    const container = document.getElementById('schedule-container');
    const timeSlots = getTimeSlots();

    let html = `<div class="schedule-grid" style="grid-template-columns: 120px repeat(${timeSlots.length}, minmax(60px, 1fr));">`;

    // Header
    html += '<div class="grid-header">';
    html += '<div class="cell cell-room">Room</div>';
    timeSlots.forEach(slot => {
      html += `<div class="cell">${slot.time}</div>`;
    });
    html += '</div>';

    // Room rows — 슬롯을 순서대로 소비하며 예약/차단/빈칸을 배치 (겹침에도 그리드가 어긋나지 않음)
    CONFIG.rooms.forEach(room => {
      html += '<div class="grid-row">';
      html += `<div class="cell cell-room">${escapeHtml(room)}</div>`;

      let i = 0;
      while (i < timeSlots.length) {
        const slot = timeSlots[i];
        const booking = findBookingAt(room, slot.time);

        if (booking) {
          const span = spanUntil(timeSlots, i, booking.endTime);
          const colorClass = getBookingColor(booking);
          html += `<div class="cell cell-slot booked" data-booking-id="${escAttr(booking.id)}" style="grid-column: span ${span};">
                     <div class="booking-block ${colorClass}">
                       <span class="booking-name">${escapeHtml(booking.name)}</span>
                       <span class="booking-topic">${escapeHtml(booking.topic || '')}</span>
                     </div>
                   </div>`;
          i += span;
          continue;
        }

        const block = findRoomBlockAt(room, slot.time);
        if (block) {
          // 차단/타 강사 예약 구간: 다른 예약이 나오기 전까지만 이어붙임
          let span = 0;
          while (i + span < timeSlots.length) {
            const t = timeSlots[i + span].time;
            if (!(block.startTime <= t && block.endTime > t)) break;
            if (findBookingAt(room, t)) break;
            span++;
          }
          span = Math.max(1, span);
          const isUnavailable = block.type === 'unavailable';
          const label = isUnavailable ? '사용 불가' : escapeHtml(block.instructor || '');
          const sub = isUnavailable ? escapeHtml(block.reason || '관리자 차단') : '사용중';
          html += `<div class="cell cell-slot room-blocked" style="grid-column: span ${span};"
                     title="${isUnavailable ? escAttr(block.reason || '관리자 차단') : escAttr((block.instructor || '') + ' 강사 사용 예정')}">
                     <div class="booking-block ${isUnavailable ? 'color-unavailable' : 'color-blocked'}">
                       <span class="booking-name">${label}</span>
                       <span class="booking-topic">${sub}</span>
                     </div>
                   </div>`;
          i += span;
          continue;
        }

        const slotEnd = i < timeSlots.length - 1 ? timeSlots[i + 1].time : endHourStr();
        html += `<div class="cell cell-slot free" data-room="${escAttr(room)}" data-time="${slot.time}" data-end="${slotEnd}"></div>`;
        i++;
      }

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    renderCurrentTimeIndicator(timeSlots);
  }

  function spanUntil(timeSlots, startIdx, endTime) {
    let span = 0;
    while (startIdx + span < timeSlots.length && timeSlots[startIdx + span].time < endTime) {
      span++;
    }
    return Math.max(1, span);
  }

  function findBookingAt(room, time) {
    return bookings.find(b =>
      b.room === room && b.startTime <= time && b.endTime > time
    );
  }

  function findRoomBlockAt(room, time) {
    return roomBlocks.find(b =>
      b.room === room && b.startTime <= time && b.endTime > time
    );
  }

  const BOOKING_COLORS = ['color-blue', 'color-green', 'color-purple', 'color-orange'];
  function getBookingColor(booking) {
    let hash = 0;
    const str = booking.id || booking.name || '';
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return BOOKING_COLORS[Math.abs(hash) % BOOKING_COLORS.length];
  }

  function renderCurrentTimeIndicator(timeSlots) {
    const now = new Date();
    if (formatDate(now) !== formatDate(currentDate)) return;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = CONFIG.startHour * 60;
    const endMinutes = CONFIG.endHour * 60;
    if (currentMinutes < startMinutes || currentMinutes > endMinutes) return;

    const grid = document.querySelector('.schedule-grid');
    if (!grid) return;
    grid.style.position = 'relative'; // offsetLeft 기준을 그리드로 만들기 위해 먼저 설정
    const headerCells = grid.querySelectorAll('.grid-header .cell');
    const minutesSinceStart = currentMinutes - startMinutes;
    const slotIdx = Math.min(Math.floor(minutesSinceStart / CONFIG.slotMinutes), timeSlots.length - 1);
    const frac = (minutesSinceStart - slotIdx * CONFIG.slotMinutes) / CONFIG.slotMinutes;
    const cell = headerCells[slotIdx + 1]; // +1: 룸 컬럼
    if (!cell) return;

    const indicator = document.createElement('div');
    indicator.className = 'current-time-line';
    indicator.style.left = `${cell.offsetLeft + frac * cell.offsetWidth}px`;
    grid.appendChild(indicator);
  }

  // === Week Grid Render ===
  function renderWeekGrid() {
    const container = document.getElementById('schedule-container');
    const timeSlots = getTimeSlots();
    const todayStr = formatDate(new Date());

    let html = `<div class="schedule-grid week-grid" style="grid-template-columns: 120px repeat(${timeSlots.length}, minmax(60px, 1fr));">`;

    html += '<div class="grid-header">';
    html += '<div class="cell cell-room">날짜</div>';
    timeSlots.forEach(slot => {
      html += `<div class="cell">${slot.time}</div>`;
    });
    html += '</div>';

    weekDays.forEach(day => {
      const d = parseDate(day.date);
      const isToday = day.date === todayStr;
      const label = `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;

      html += '<div class="grid-row">';
      html += `<div class="cell cell-room wk-day-label ${isToday ? 'today' : ''}" data-goto-date="${day.date}">${label}</div>`;

      timeSlots.forEach(slot => {
        const covering = day.bookings.filter(b => b.startTime <= slot.time && b.endTime > slot.time);
        if (covering.length === 0) {
          html += `<div class="cell cell-slot wk-free" data-goto-date="${day.date}"></div>`;
        } else if (covering.length === 1) {
          const b = covering[0];
          const isStart = b.startTime === slot.time;
          html += `<div class="cell cell-slot wk-busy ${getBookingColor(b)} ${isStart ? 'wk-start' : ''}"
                     data-booking-id="${escAttr(b.id)}">
                     ${isStart ? `<span class="wk-label">${escapeHtml(b.name)} · ${escapeHtml(b.room)}</span>` : ''}
                   </div>`;
        } else {
          html += `<div class="cell cell-slot wk-busy wk-multi" data-goto-date="${day.date}">
                     <span class="wk-label">${covering.length}건</span>
                   </div>`;
        }
      });

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // === 로딩 스켈레톤 / 에러 ===
  function renderSkeleton() {
    const container = document.getElementById('schedule-container');
    const rowCount = currentView === 'week' ? 7 : Math.min(CONFIG.rooms.length, 8);
    let html = '<div class="skeleton-grid">';
    html += '<div class="skeleton-row skeleton-header"><div class="skeleton-bar" style="width:100px;"></div><div class="skeleton-bar" style="flex:1;"></div></div>';
    for (let i = 0; i < rowCount; i++) {
      html += '<div class="skeleton-row"><div class="skeleton-bar" style="width:100px;"></div><div class="skeleton-bar" style="flex:1;"></div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function renderLoadError() {
    const container = document.getElementById('schedule-container');
    container.innerHTML = `
      <div class="no-config-message">
        <h3>데이터를 불러오지 못했습니다</h3>
        <p>네트워크 상태를 확인한 후 새로고침 해주세요.</p>
      </div>`;
  }

  // === 그리드 상호작용 (포인터 이벤트 위임) ===
  function onGridPointerDown(e) {
    const cell = e.target.closest('.cell-slot.free');
    if (!cell) return;

    if (e.pointerType === 'mouse') {
      e.preventDefault();
      isDragging = true;
      dragStartSlot = cell;
      clearSelectingClass();
      selectedSlots = [cell];
      cell.classList.add('selecting');
    } else {
      // 터치/펜: 탭 판정을 위해 시작 좌표만 기록 (스크롤 방해 금지)
      touchTapStart = { x: e.clientX, y: e.clientY, cell };
    }
  }

  function onGridPointerOver(e) {
    if (!isDragging || e.pointerType !== 'mouse') return;
    const cell = e.target.closest('.cell-slot');
    if (!cell || !cell.classList.contains('free')) return;
    if (cell.dataset.room !== dragStartSlot.dataset.room) return;
    selectRangeBetween(dragStartSlot, cell);
  }

  function onDocumentPointerUp(e) {
    if (isDragging) {
      isDragging = false;
      if (selectedSlots.length > 0) openBookingModal();
      return;
    }

    // 터치 탭 (이동 거리가 작을 때만)
    if (touchTapStart && e.pointerType !== 'mouse') {
      const moved = Math.hypot(e.clientX - touchTapStart.x, e.clientY - touchTapStart.y);
      const cell = touchTapStart.cell;
      touchTapStart = null;
      if (moved < 12 && cell.isConnected) handleTouchTap(cell);
    }
  }

  function handleTouchTap(cell) {
    if (!touchAnchor) {
      touchAnchor = cell;
      cell.classList.add('selecting');
      showToast('시작 시간을 선택했습니다. 종료 슬롯을 탭하세요.', 'info');
      return;
    }

    if (touchAnchor === cell) {
      // 같은 셀 재탭 = 단일 슬롯 예약
      selectedSlots = [cell];
      touchAnchor = null;
      openBookingModal();
      return;
    }

    if (touchAnchor.dataset.room !== cell.dataset.room) {
      // 다른 룸 탭 = 시작점 이동
      clearSelectingClass();
      touchAnchor = cell;
      cell.classList.add('selecting');
      return;
    }

    // 범위 선택 (중간에 예약이 있으면 그 앞까지만 선택됨)
    const ok = selectRangeBetween(touchAnchor, cell);
    touchAnchor = null;
    if (ok) {
      openBookingModal();
    } else {
      clearSelection();
    }
  }

  // anchor→target 범위 선택. 중간에 예약/차단이 있으면 그 앞까지만 선택
  // (빈 셀만 DOM에 남아 있으므로, 이전 슬롯의 끝 = 다음 슬롯의 시작인지로 연속성을 검사)
  function selectRangeBetween(anchor, target) {
    const room = anchor.dataset.room;
    const cells = Array.from(document.querySelectorAll(`.cell-slot.free[data-room="${cssEscape(room)}"]`));
    const a = cells.indexOf(anchor);
    const b = cells.indexOf(target);
    if (a === -1 || b === -1) return false;

    clearSelectingClass();
    const range = [anchor];

    if (b >= a) {
      for (let i = a + 1; i <= b; i++) {
        if (cells[i - 1].dataset.end !== cells[i].dataset.time) break; // 중간에 예약 있음
        range.push(cells[i]);
      }
    } else {
      for (let i = a - 1; i >= b; i--) {
        if (cells[i].dataset.end !== cells[i + 1].dataset.time) break;
        range.unshift(cells[i]);
      }
    }

    range.forEach(c => c.classList.add('selecting'));
    selectedSlots = range;
    return range.length > 0;
  }

  function onGridClick(e) {
    // 예약 블록 클릭 → 상세 (마우스/터치 공통)
    const bookedCell = e.target.closest('[data-booking-id]');
    if (bookedCell) {
      showBookingDetail(bookedCell.dataset.bookingId);
      return;
    }
    // 주간 뷰: 빈 칸/날짜 클릭 → 해당 날짜 일간 뷰로 이동 (마우스만; 터치는 탭 핸들러와 충돌 없음)
    const gotoCell = e.target.closest('[data-goto-date]');
    if (gotoCell && currentView === 'week') {
      currentView = 'day';
      document.getElementById('btn-view-day').classList.add('active');
      document.getElementById('btn-view-week').classList.remove('active');
      setDate(parseDate(gotoCell.dataset.gotoDate));
    }
  }

  // === Time Dropdown Helpers ===
  function populateTimeDropdowns(startVal, endVal) {
    const startSelect = document.getElementById('input-start-time');
    const slots = getTimeSlots();

    startSelect.innerHTML = '';
    slots.forEach(slot => {
      const opt = document.createElement('option');
      opt.value = slot.time;
      opt.textContent = slot.time;
      startSelect.appendChild(opt);
    });
    startSelect.value = startVal || slots[0].time;

    updateEndTimeOptions(startSelect.value, endVal);
    startSelect.onchange = function () {
      updateEndTimeOptions(this.value);
    };
  }

  function updateEndTimeOptions(startTime, selectedEnd) {
    const endSelect = document.getElementById('input-end-time');
    const slots = getTimeSlots();

    endSelect.innerHTML = '';
    let foundStart = false;
    slots.forEach(slot => {
      if (slot.time === startTime) {
        foundStart = true;
        return;
      }
      if (foundStart) {
        const opt = document.createElement('option');
        opt.value = slot.time;
        opt.textContent = slot.time;
        endSelect.appendChild(opt);
      }
    });
    const lastOpt = document.createElement('option');
    lastOpt.value = endHourStr();
    lastOpt.textContent = endHourStr();
    endSelect.appendChild(lastOpt);

    if (selectedEnd && endSelect.querySelector(`option[value="${selectedEnd}"]`)) {
      endSelect.value = selectedEnd;
    }
  }

  // === Booking Modal ===
  function openBookingModal() {
    if (selectedSlots.length === 0) return;

    const room = selectedSlots[0].dataset.room;
    const startTime = selectedSlots[0].dataset.time;
    const endTime = selectedSlots[selectedSlots.length - 1].dataset.end;

    modalContext = { room, date: formatDate(currentDate), instructor: currentInstructor };

    document.getElementById('modal-booking-title').textContent = '예약하기';
    setBookingInfo(room, modalContext.date);
    populateTimeDropdowns(startTime, endTime);

    document.getElementById('input-name').value = '';
    document.getElementById('input-course').value = '';
    document.getElementById('input-topic').value = '';
    document.getElementById('input-people').value = '1';
    document.getElementById('input-email').value = '';
    document.getElementById('input-password').value = '';
    document.getElementById('btn-submit-booking').textContent = '예약하기';
    currentBookingId = null;

    openModal('modal-booking');
  }

  function setBookingInfo(room, date) {
    const info = document.getElementById('booking-info');
    info.innerHTML = '';
    const roomEl = document.createElement('div');
    roomEl.className = 'form-info-item';
    const strong = document.createElement('strong');
    strong.textContent = room;
    roomEl.appendChild(strong);
    const dateEl = document.createElement('div');
    dateEl.className = 'form-info-item';
    dateEl.textContent = date;
    info.append(roomEl, dateEl);
  }

  async function handleBookingSubmit() {
    const name = document.getElementById('input-name').value.trim();
    const course = document.getElementById('input-course').value.trim();
    const topic = document.getElementById('input-topic').value.trim();
    const people = document.getElementById('input-people').value;
    const email = document.getElementById('input-email').value.trim();
    const password = document.getElementById('input-password').value;

    if (!name || !course || !topic || !password) {
      showToast('모든 필수 항목을 입력해주세요.', 'error');
      return;
    }
    if (password.length < 4) {
      showToast('비밀번호는 4자 이상이어야 합니다.', 'error');
      return;
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showToast('이메일 형식이 올바르지 않습니다.', 'error');
      return;
    }

    const startTime = document.getElementById('input-start-time').value;
    const endTime = document.getElementById('input-end-time').value;
    if (!startTime || !endTime || startTime >= endTime) {
      showToast('시간을 올바르게 선택해주세요.', 'error');
      return;
    }
    if (!modalContext) return;

    const payload = {
      date: modalContext.date,
      instructor: modalContext.instructor,
      room: modalContext.room,
      startTime, endTime, name, course, topic, people, email,
    };

    showLoading(true);
    try {
      if (currentBookingId) {
        await API.updateBooking(currentBookingId, payload, password);
        showToast('예약이 수정되었습니다.', 'success');
      } else {
        await API.createBooking({ ...payload, password });
        showToast(email ? '예약이 완료되었습니다. 확인 메일이 발송됩니다.' : '예약이 완료되었습니다.', 'success');
      }
      closeModal('modal-booking');
      clearSelection();
      loadCurrentView();
    } catch (err) {
      showToast(err.message || '예약 처리에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  // === Booking Detail ===
  function findBookingById(id) {
    const inDay = bookings.find(b => b.id === id);
    if (inDay) return inDay;
    for (const day of weekDays) {
      const found = (day.bookings || []).find(b => b.id === id);
      if (found) return found;
    }
    return null;
  }

  function showBookingDetail(bookingId) {
    const booking = findBookingById(bookingId);
    if (!booking) return;

    currentBookingId = bookingId;

    const rows = [
      ['강사', booking.instructor || '-'],
      ['룸', booking.room],
      ['날짜', booking.date],
      ['시간', `${booking.startTime} ~ ${booking.endTime}`],
      ['예약자', booking.name],
      ['과정명', booking.course || '-'],
      ['주제', booking.topic || '-'],
      ['인원', `${booking.people || 1}명`],
    ];

    const grid = document.getElementById('detail-grid');
    grid.innerHTML = '';
    rows.forEach(([label, value]) => {
      const l = document.createElement('div');
      l.className = 'detail-label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'detail-value';
      v.textContent = value;
      grid.append(l, v);
    });

    openModal('modal-detail');
  }

  async function handlePasswordConfirm() {
    const password = document.getElementById('input-confirm-password').value;
    if (!password) {
      showToast('비밀번호를 입력해주세요.', 'error');
      return;
    }

    closeModal('modal-password');

    if (pendingAction === 'delete') {
      showLoading(true);
      try {
        await API.deleteBooking(currentBookingId, password);
        showToast('예약이 삭제되었습니다.', 'success');
        closeModal('modal-detail');
        loadCurrentView();
      } catch (err) {
        showToast(err.message || '삭제에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    } else if (pendingAction === 'edit') {
      const booking = findBookingById(currentBookingId);
      if (!booking) return;

      // 데모 모드에서는 즉시 비밀번호 확인 (운영 모드는 서버가 수정 시점에 검증)
      if (!CONFIG.SCRIPT_URL) {
        const stored = DemoAPI._bookings.find(b => b.id === currentBookingId);
        if (stored && stored.password !== password) {
          showToast('비밀번호가 일치하지 않습니다.', 'error');
          return;
        }
      }

      closeModal('modal-detail');

      modalContext = { room: booking.room, date: booking.date, instructor: booking.instructor || currentInstructor };

      document.getElementById('modal-booking-title').textContent = '예약 수정';
      setBookingInfo(booking.room, booking.date);
      populateTimeDropdowns(booking.startTime, booking.endTime);

      document.getElementById('input-name').value = booking.name || '';
      document.getElementById('input-course').value = booking.course || '';
      document.getElementById('input-topic').value = booking.topic || '';
      document.getElementById('input-people').value = booking.people || '1';
      document.getElementById('input-email').value = '';
      document.getElementById('input-password').value = password;
      document.getElementById('btn-submit-booking').textContent = '수정하기';
      currentBookingId = booking.id;

      openModal('modal-booking');
    }

    pendingAction = null;
  }

  // === 내 예약 ===
  function openMyBookingsModal() {
    document.getElementById('input-my-name').value = '';
    document.getElementById('input-my-password').value = '';
    document.getElementById('my-bookings-list').innerHTML = '';
    myCreds = null;
    openModal('modal-my-bookings');
  }

  async function handleMySearch() {
    const name = document.getElementById('input-my-name').value.trim();
    const password = document.getElementById('input-my-password').value;
    if (!name || !password) {
      showToast('이름과 비밀번호를 입력해주세요.', 'error');
      return;
    }

    showLoading(true);
    try {
      const result = await API.getMyBookings(name, password);
      myCreds = { name, password };
      renderMyBookings(result.bookings || []);
    } catch (err) {
      showToast(err.message || '조회에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  function renderMyBookings(list) {
    const container = document.getElementById('my-bookings-list');
    container.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'my-bookings-empty';
      empty.textContent = '해당 이름/비밀번호로 등록된 예약이 없습니다.';
      container.appendChild(empty);
      return;
    }

    const todayStr = formatDate(new Date());
    list.forEach(b => {
      const item = document.createElement('div');
      item.className = 'my-booking-item' + (b.date < todayStr ? ' past' : '');

      const info = document.createElement('div');
      info.className = 'my-booking-info';
      const title = document.createElement('div');
      title.className = 'my-booking-title';
      title.textContent = `${b.date} ${b.startTime}~${b.endTime}`;
      const sub = document.createElement('div');
      sub.className = 'my-booking-sub';
      sub.textContent = `${b.room} · ${b.instructor || '-'} · ${b.topic || b.course || ''}`;
      info.append(title, sub);

      const actions = document.createElement('div');
      actions.className = 'my-booking-actions';
      const goBtn = document.createElement('button');
      goBtn.className = 'btn-sm';
      goBtn.textContent = '보기';
      goBtn.dataset.action = 'goto';
      goBtn.dataset.date = b.date;
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-sm danger';
      delBtn.textContent = '취소';
      delBtn.dataset.action = 'cancel';
      delBtn.dataset.id = b.id;
      actions.append(goBtn, delBtn);

      item.append(info, actions);
      container.appendChild(item);
    });
  }

  async function handleMyBookingsListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'goto') {
      closeModal('modal-my-bookings');
      currentView = 'day';
      document.getElementById('btn-view-day').classList.add('active');
      document.getElementById('btn-view-week').classList.remove('active');
      setDate(parseDate(btn.dataset.date));
      return;
    }

    if (btn.dataset.action === 'cancel' && myCreds) {
      if (!confirm('이 예약을 취소하시겠습니까?')) return;
      showLoading(true);
      try {
        await API.deleteBooking(btn.dataset.id, myCreds.password);
        showToast('예약이 취소되었습니다.', 'success');
        const result = await API.getMyBookings(myCreds.name, myCreds.password);
        renderMyBookings(result.bookings || []);
        loadCurrentView();
      } catch (err) {
        showToast(err.message || '취소에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    }
  }

  // === Helpers ===
  function clearSelectingClass() {
    document.querySelectorAll('.cell-slot.selecting').forEach(c => c.classList.remove('selecting'));
  }

  function clearSelection() {
    clearSelectingClass();
    selectedSlots = [];
    touchAnchor = null;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 속성 값용 escape (따옴표 포함)
  function escAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssEscape(str) {
    return (window.CSS && CSS.escape) ? CSS.escape(str) : String(str).replace(/["\\]/g, '\\$&');
  }

  // === Modal Helpers (HTML의 정적 onclick에서 사용) ===
  window.openModal = function (id) {
    document.getElementById(id).classList.add('active');
  };

  window.closeModal = function (id) {
    document.getElementById(id).classList.remove('active');
    if (id === 'modal-booking') {
      clearSelection();
    }
  };

  // === Toast ===
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  window.showToast = showToast;

  // === Loading (변경 작업용 오버레이 — 조회는 스켈레톤 사용) ===
  function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
  }
  window.showLoading = showLoading;

})();
