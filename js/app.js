/**
 * 멘토링 예약 시스템 - 메인 앱 로직
 */
(function () {
  // === State ===
  let currentDate = new Date();
  let currentInstructor = '';   // 현재 선택된 강사
  let bookings = [];
  let roomBlocks = [];      // 다른 강사의 룸 사용 정보
  let selectedSlots = [];   // 드래그 선택된 슬롯들
  let isDragging = false;
  let dragStartSlot = null;
  let currentBookingId = null;  // 상세보기 중인 예약 ID
  let pendingAction = null;     // 비밀번호 확인 후 실행할 액션

  // === Init ===
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    // Set title
    document.getElementById('sidebar-title').textContent = CONFIG.subtitle || CONFIG.title;
    document.title = CONFIG.title;

    // 캐시된 강사 목록이 있으면 먼저 UI에 반영 (즉시 표시)
    const cached = API.getCachedInstructors();
    if (cached && cached.length > 0) {
      populateInstructorSelect(cached);
    }

    // 통합 API 1회 호출로 강사 목록 + 오늘 예약 동시 로딩
    currentDate = new Date();
    document.getElementById('date-picker').value = formatDate(currentDate);
    showLoading(true);
    try {
      const data = await API.getInit(formatDate(currentDate), currentInstructor);
      populateInstructorSelect(data.instructors);
      bookings = data.bookings || [];
      roomBlocks = data.roomBlocks || [];
      renderGrid();
    } catch (err) {
      showToast('데이터를 불러오는데 실패했습니다.', 'error');
      console.error(err);
    } finally {
      showLoading(false);
    }

    // Event listeners
    document.getElementById('btn-prev').addEventListener('click', () => navigateDate(-1));
    document.getElementById('btn-next').addEventListener('click', () => navigateDate(1));
    document.getElementById('btn-today').addEventListener('click', () => setDate(new Date()));
    document.getElementById('date-picker').addEventListener('change', (e) => {
      setDate(new Date(e.target.value + 'T00:00:00'));
    });

    // Booking form submit
    document.getElementById('btn-submit-booking').addEventListener('click', handleBookingSubmit);

    // Detail modal actions
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

    // Password confirm
    document.getElementById('btn-confirm-password').addEventListener('click', handlePasswordConfirm);

    // Enter key for password
    document.getElementById('input-confirm-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePasswordConfirm();
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
      }
    });
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

    // 이전 선택값 유지, 없으면 첫 번째 강사
    if (prevValue && instructors.includes(prevValue)) {
      currentInstructor = prevValue;
    } else {
      currentInstructor = instructors[0] || '';
    }
    select.value = currentInstructor;

    // change 이벤트는 최초 1회만 바인딩
    if (!instructorSelectBound) {
      select.addEventListener('change', (e) => {
        currentInstructor = e.target.value;
        loadBookings();
      });
      instructorSelectBound = true;
    }
  }

  // === Date Management ===
  function setDate(date) {
    currentDate = date;
    document.getElementById('date-picker').value = formatDate(date);
    loadBookings();
  }

  function navigateDate(delta) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + delta);
    setDate(d);
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
        hour,
        min,
      });
    }
    return slots;
  }

  // === Load & Render ===
  async function loadBookings() {
    showLoading(true);
    try {
      const result = await API.getBookings(formatDate(currentDate), currentInstructor);
      bookings = result.bookings || [];
      roomBlocks = result.roomBlocks || [];
      renderGrid();
    } catch (err) {
      showToast('데이터를 불러오는데 실패했습니다.', 'error');
      console.error(err);
    } finally {
      showLoading(false);
    }
  }

  function renderGrid() {
    const container = document.getElementById('schedule-container');
    const timeSlots = getTimeSlots();
    const colCount = timeSlots.length + 1; // +1 for room column

    // Build grid
    container.style.cssText = '';
    let html = `<div class="schedule-grid" style="grid-template-columns: 120px repeat(${timeSlots.length}, minmax(60px, 1fr));">`;

    // Header row
    html += '<div class="grid-header">';
    html += '<div class="cell cell-room">Room</div>';
    timeSlots.forEach(slot => {
      html += `<div class="cell">${slot.time}</div>`;
    });
    html += '</div>';

    // Room rows
    CONFIG.rooms.forEach(room => {
      html += '<div class="grid-row">';
      html += `<div class="cell cell-room">${room}</div>`;

      timeSlots.forEach((slot, slotIdx) => {
        const booking = findBookingAt(room, slot.time);
        const block = findRoomBlockAt(room, slot.time);
        const slotEnd = slotIdx < timeSlots.length - 1 ? timeSlots[slotIdx + 1].time : `${CONFIG.endHour}:00`;

        if (booking) {
          // 현재 강사의 예약
          if (booking.startTime === slot.time) {
            const span = getBookingSpan(booking, timeSlots);
            const colorClass = getBookingColor(booking);
            html += `<div class="cell cell-slot booked"
                      data-room="${room}" data-time="${slot.time}" data-end="${slotEnd}"
                      data-booking-id="${booking.id}"
                      style="grid-column: span ${span}; position: relative;"
                      onclick="showBookingDetail('${booking.id}')">
                      <div class="booking-block ${colorClass}">
                        <span class="booking-name">${escapeHtml(booking.name)}</span>
                        <span class="booking-topic">${escapeHtml(booking.topic || '')}</span>
                      </div>
                    </div>`;
          }
        } else if (block) {
          // 다른 강사의 예약 → 사용중 표시
          if (block.startTime === slot.time) {
            const span = getRoomBlockSpan(block, timeSlots);
            html += `<div class="cell cell-slot room-blocked"
                      data-room="${room}" data-time="${slot.time}" data-end="${slotEnd}"
                      style="grid-column: span ${span}; position: relative;"
                      title="${escapeHtml(block.instructor)} 강사 사용 예정">
                      <div class="booking-block color-blocked">
                        <span class="booking-name">${escapeHtml(block.instructor)}</span>
                        <span class="booking-topic">사용중</span>
                      </div>
                    </div>`;
          }
        } else {
          html += `<div class="cell cell-slot"
                    data-room="${room}" data-time="${slot.time}" data-end="${slotEnd}"
                    onmousedown="startDrag(this, event)"
                    onmouseenter="continueDrag(this)"
                    onmouseup="endDrag(this)"></div>`;
        }
      });

      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Add current time indicator
    renderCurrentTimeIndicator(timeSlots);
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

  function getRoomBlockSpan(block, timeSlots) {
    const startIdx = timeSlots.findIndex(s => s.time === block.startTime);
    const endIdx = timeSlots.findIndex(s => s.time === block.endTime);
    const end = endIdx === -1 ? timeSlots.length : endIdx;
    return Math.max(1, end - (startIdx === -1 ? 0 : startIdx));
  }

  function getBookingSpan(booking, timeSlots) {
    const startIdx = timeSlots.findIndex(s => s.time === booking.startTime);
    const endIdx = timeSlots.findIndex(s => s.time === booking.endTime);
    const end = endIdx === -1 ? timeSlots.length : endIdx;
    return Math.max(1, end - startIdx);
  }

  const BOOKING_COLORS = ['color-blue', 'color-green', 'color-purple', 'color-orange'];
  function getBookingColor(booking) {
    let hash = 0;
    const str = booking.id || booking.name;
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

    const slotWidth = 60; // approximate px per slot
    const totalSlots = timeSlots.length;
    const minutesSinceStart = currentMinutes - startMinutes;
    const totalMinutes = endMinutes - startMinutes;
    const percentage = minutesSinceStart / totalMinutes;

    const grid = document.querySelector('.schedule-grid');
    if (!grid) return;

    const indicator = document.createElement('div');
    indicator.className = 'current-time-line';
    indicator.style.left = `${120 + (grid.scrollWidth - 120) * percentage}px`;
    grid.style.position = 'relative';
    grid.appendChild(indicator);
  }

  // === Drag Selection ===
  window.startDrag = function (cell, event) {
    event.preventDefault();
    isDragging = true;
    selectedSlots = [cell];
    dragStartSlot = cell;
    cell.classList.add('selecting');

    // Mouse up on document
    document.addEventListener('mouseup', globalMouseUp, { once: true });
  };

  window.continueDrag = function (cell) {
    if (!isDragging) return;
    if (cell.classList.contains('booked') || cell.classList.contains('room-blocked')) return;

    const startRoom = dragStartSlot.dataset.room;
    if (cell.dataset.room !== startRoom) return;

    // Clear previous selection
    document.querySelectorAll('.cell-slot.selecting').forEach(c => c.classList.remove('selecting'));

    // Select range
    const allCells = Array.from(document.querySelectorAll(`.cell-slot[data-room="${startRoom}"]`));
    const startIdx = allCells.indexOf(dragStartSlot);
    const endIdx = allCells.indexOf(cell);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);

    selectedSlots = [];
    for (let i = minIdx; i <= maxIdx; i++) {
      if (!allCells[i].classList.contains('booked')) {
        allCells[i].classList.add('selecting');
        selectedSlots.push(allCells[i]);
      }
    }
  };

  window.endDrag = function (cell) {
    if (!isDragging) return;
    isDragging = false;

    if (selectedSlots.length > 0) {
      openBookingModal();
    }
  };

  function globalMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    if (selectedSlots.length > 0) {
      openBookingModal();
    }
  }

  // === Time Dropdown Helpers ===
  function populateTimeDropdowns(startVal, endVal) {
    const startSelect = document.getElementById('input-start-time');
    const endSelect = document.getElementById('input-end-time');
    const slots = getTimeSlots();
    const endHourStr = `${String(CONFIG.endHour).padStart(2, '0')}:00`;

    // Populate start time options
    startSelect.innerHTML = '';
    slots.forEach(slot => {
      const opt = document.createElement('option');
      opt.value = slot.time;
      opt.textContent = slot.time;
      startSelect.appendChild(opt);
    });
    startSelect.value = startVal || slots[0].time;

    // Populate end time based on start
    updateEndTimeOptions(startSelect.value, endVal);

    // When start changes, update end options
    startSelect.onchange = function () {
      updateEndTimeOptions(this.value);
    };
  }

  function updateEndTimeOptions(startTime, selectedEnd) {
    const endSelect = document.getElementById('input-end-time');
    const slots = getTimeSlots();
    const endHourStr = `${String(CONFIG.endHour).padStart(2, '0')}:00`;

    endSelect.innerHTML = '';

    // End time options: from (startTime + 30min) to endHour
    let foundStart = false;
    slots.forEach(slot => {
      if (slot.time === startTime) {
        foundStart = true;
        return; // skip the start time itself
      }
      if (foundStart) {
        const opt = document.createElement('option');
        opt.value = slot.time;
        opt.textContent = slot.time;
        endSelect.appendChild(opt);
      }
    });
    // Add the final endHour option
    const lastOpt = document.createElement('option');
    lastOpt.value = endHourStr;
    lastOpt.textContent = endHourStr;
    endSelect.appendChild(lastOpt);

    // Set selected end time
    if (selectedEnd && endSelect.querySelector(`option[value="${selectedEnd}"]`)) {
      endSelect.value = selectedEnd;
    }
  }

  // === Booking Modal ===
  function openBookingModal() {
    if (selectedSlots.length === 0) return;

    const room = selectedSlots[0].dataset.room;
    const startTime = selectedSlots[0].dataset.time;
    const lastSlot = selectedSlots[selectedSlots.length - 1];
    const endTime = lastSlot.dataset.end;

    document.getElementById('modal-booking-title').textContent = '예약하기';
    document.getElementById('booking-info').innerHTML = `
      <div class="form-info-item"><strong>${room}</strong></div>
      <div class="form-info-item">${formatDate(currentDate)}</div>
    `;

    // Populate time dropdowns
    populateTimeDropdowns(startTime, endTime);

    // Clear form
    document.getElementById('input-name').value = '';
    document.getElementById('input-course').value = '';
    document.getElementById('input-topic').value = '';
    document.getElementById('input-people').value = '1';
    document.getElementById('input-password').value = '';
    document.getElementById('btn-submit-booking').textContent = '예약하기';
    currentBookingId = null;

    openModal('modal-booking');
  }

  async function handleBookingSubmit() {
    const name = document.getElementById('input-name').value.trim();
    const course = document.getElementById('input-course').value.trim();
    const topic = document.getElementById('input-topic').value.trim();
    const people = document.getElementById('input-people').value;
    const password = document.getElementById('input-password').value;

    if (!name || !course || !topic || !password) {
      showToast('모든 필수 항목을 입력해주세요.', 'error');
      return;
    }

    if (password.length < 4) {
      showToast('비밀번호는 4자 이상이어야 합니다.', 'error');
      return;
    }

    const room = selectedSlots[0]?.dataset.room;
    const startTime = document.getElementById('input-start-time').value;
    const endTime = document.getElementById('input-end-time').value;

    if (!startTime || !endTime || startTime >= endTime) {
      showToast('시간을 올바르게 선택해주세요.', 'error');
      return;
    }

    showLoading(true);
    try {
      if (currentBookingId) {
        // Update
        await API.updateBooking(currentBookingId, {
          date: formatDate(currentDate),
          instructor: currentInstructor,
          room, startTime, endTime,
          name, course, topic, people,
        }, password);
        showToast('예약이 수정되었습니다.', 'success');
      } else {
        // Create
        await API.createBooking({
          date: formatDate(currentDate),
          instructor: currentInstructor,
          room, startTime, endTime,
          name, course, topic, people, password,
        });
        showToast('예약이 완료되었습니다.', 'success');
      }
      closeModal('modal-booking');
      clearSelection();
      await loadBookings();
    } catch (err) {
      showToast(err.message || '예약 처리에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  // === Booking Detail ===
  window.showBookingDetail = function (bookingId) {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    currentBookingId = bookingId;

    document.getElementById('detail-grid').innerHTML = `
      <div class="detail-label">강사</div>
      <div class="detail-value">${escapeHtml(booking.instructor || '-')}</div>
      <div class="detail-label">룸</div>
      <div class="detail-value">${escapeHtml(booking.room)}</div>
      <div class="detail-label">날짜</div>
      <div class="detail-value">${booking.date}</div>
      <div class="detail-label">시간</div>
      <div class="detail-value">${booking.startTime} ~ ${booking.endTime}</div>
      <div class="detail-label">예약자</div>
      <div class="detail-value">${escapeHtml(booking.name)}</div>
      <div class="detail-label">과정명</div>
      <div class="detail-value">${escapeHtml(booking.course || '-')}</div>
      <div class="detail-label">주제</div>
      <div class="detail-value">${escapeHtml(booking.topic || '-')}</div>
      <div class="detail-label">인원</div>
      <div class="detail-value">${booking.people || 1}명</div>
    `;

    openModal('modal-detail');
  };

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
        await loadBookings();
      } catch (err) {
        showToast(err.message || '삭제에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    } else if (pendingAction === 'edit') {
      // Verify password first
      const booking = bookings.find(b => b.id === currentBookingId);
      if (!booking) return;

      // In demo mode, check password directly
      if (!CONFIG.SCRIPT_URL) {
        const stored = API._demoStore.find(b => b.id === currentBookingId);
        if (stored && stored.password !== password) {
          showToast('비밀번호가 일치하지 않습니다.', 'error');
          return;
        }
      }

      closeModal('modal-detail');

      // Pre-fill booking form for editing
      selectedSlots = [];
      const room = booking.room;
      const allCells = Array.from(document.querySelectorAll(`.cell-slot[data-room="${room}"]`));
      // Find start and end cells
      allCells.forEach(cell => {
        const t = cell.dataset.time;
        if (t >= booking.startTime && t < booking.endTime) {
          selectedSlots.push(cell);
          cell.classList.add('selecting');
        }
      });

      if (selectedSlots.length === 0) {
        // Fallback: create virtual selection info
        selectedSlots = [{
          dataset: { room: booking.room, time: booking.startTime, end: booking.endTime }
        }];
      }

      document.getElementById('modal-booking-title').textContent = '예약 수정';
      document.getElementById('booking-info').innerHTML = `
        <div class="form-info-item"><strong>${escapeHtml(booking.room)}</strong></div>
        <div class="form-info-item">${booking.date}</div>
      `;

      // Populate time dropdowns with current booking times
      populateTimeDropdowns(booking.startTime, booking.endTime);

      document.getElementById('input-name').value = booking.name || '';
      document.getElementById('input-course').value = booking.course || '';
      document.getElementById('input-topic').value = booking.topic || '';
      document.getElementById('input-people').value = booking.people || '1';
      document.getElementById('input-password').value = password;
      document.getElementById('btn-submit-booking').textContent = '수정하기';
      currentBookingId = booking.id;

      openModal('modal-booking');
    }

    pendingAction = null;
  }

  // === Helpers ===
  function clearSelection() {
    document.querySelectorAll('.cell-slot.selecting').forEach(c => c.classList.remove('selecting'));
    selectedSlots = [];
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // === Modal Helpers (global) ===
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

  // === Loading ===
  function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
  }
  window.showLoading = showLoading;

})();
