/**
 * 관리자 페이지 로직
 * - 세션 토큰 기반 인증 (비밀번호는 로그인 시 1회만 전송, 저장하지 않음)
 * - 동적 콘텐츠는 전부 DOM API로 생성 (innerHTML에 사용자 데이터를 넣지 않음)
 */
(function () {
  let token = '';
  let currentPage = 1;
  let searchTimeout = null;
  let adminConfig = null;        // {rooms, startHour, endHour, slotMinutes}
  let instructorList = [];
  let blocks = [];
  let lastBookings = [];         // 현재 페이지의 예약 목록 (삭제 정보 표시용)

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const BAR_COLOR = '#2a78d6'; // 단일 시리즈 막대 색 (검증된 팔레트 blue)

  document.addEventListener('DOMContentLoaded', () => {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
      token = saved;
      showDashboard();
    }
    bindEvents();
  });

  function bindEvents() {
    // 예약 삭제 확정
    document.getElementById('btn-admin-confirm-delete').addEventListener('click', executeAdminDelete);
    document.getElementById('modal-admin-delete').addEventListener('click', (e) => {
      if (e.target.id === 'modal-admin-delete') closeAdminModal();
    });

    // 예약 테이블/페이지네이션 (위임)
    document.getElementById('admin-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (btn) openDeleteModal(btn.dataset.id);
    });
    document.getElementById('admin-pagination').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (btn) {
        currentPage = parseInt(btn.dataset.page, 10);
        loadAdminBookings();
      }
    });

    // CSV 내보내기
    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);

    // 강사 관리
    document.getElementById('btn-instructor-submit').addEventListener('click', submitInstructor);
    document.getElementById('btn-instructor-confirm-delete').addEventListener('click', executeInstructorDelete);
    document.getElementById('input-instructor-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitInstructor();
    });
    document.getElementById('instructor-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') openInstructorModal('edit', btn.dataset.name);
      if (btn.dataset.action === 'delete') confirmInstructorDelete(btn.dataset.name);
    });
    document.getElementById('modal-instructor').addEventListener('click', (e) => {
      if (e.target.id === 'modal-instructor') closeInstructorModal();
    });
    document.getElementById('modal-instructor-delete').addEventListener('click', (e) => {
      if (e.target.id === 'modal-instructor-delete') closeInstructorDeleteModal();
    });

    // 룸 차단
    document.getElementById('btn-add-block').addEventListener('click', submitBlock);
    document.getElementById('block-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-block-id]');
      if (!btn) return;
      if (!confirm('이 차단을 해제하시겠습니까?')) return;
      showLoading(true);
      try {
        const result = await API.adminDeleteBlock(btn.dataset.blockId, token);
        blocks = result.blocks || [];
        renderBlocks();
        showToast('차단이 해제되었습니다.', 'success');
      } catch (err) {
        handleError(err, '차단 해제에 실패했습니다.');
      } finally {
        showLoading(false);
      }
    });
  }

  // === 공통 에러 처리 (인증 만료 시 자동 로그아웃) ===
  function handleError(err, fallback) {
    showToast(err.message || fallback, 'error');
    if (err.message && err.message.includes('인증')) {
      adminLogout();
    }
  }

  // === Login / Logout ===
  window.adminLoginSubmit = async function () {
    const pw = document.getElementById('admin-password').value;
    if (!pw) {
      showToast('비밀번호를 입력해주세요.', 'error');
      return;
    }

    showLoading(true);
    try {
      const result = await API.adminLogin(pw);
      if (result.success && result.token) {
        token = result.token;
        sessionStorage.setItem('admin_token', token);
        document.getElementById('admin-password').value = '';
        showDashboard();
        showToast('로그인되었습니다.', 'success');
      }
    } catch (err) {
      showToast(err.message || '로그인에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  };

  window.adminLogout = function () {
    token = '';
    sessionStorage.removeItem('admin_token');
    document.getElementById('login-section').style.display = '';
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'none';
    showToast('로그아웃되었습니다.', 'info');
  };

  async function showDashboard() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = '';
    document.getElementById('btn-logout').style.display = '';

    showLoading(true);
    try {
      const data = await API.adminInit(token);
      adminConfig = data.config || {
        rooms: CONFIG.rooms, startHour: CONFIG.startHour,
        endHour: CONFIG.endHour, slotMinutes: CONFIG.slotMinutes,
      };
      instructorList = data.instructors || [];
      blocks = data.blocks || [];
      renderStats(data.stats);
      renderInstructorList();
      populateBlockForm();
      renderBlocks();
    } catch (err) {
      handleError(err, '대시보드 데이터를 불러오지 못했습니다.');
      return;
    } finally {
      showLoading(false);
    }

    loadAdminBookings();
  }

  // === 통계 ===
  function renderStats(stats) {
    if (!stats) return;

    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-upcoming').textContent = stats.upcoming;
    document.getElementById('stat-today').textContent = stats.todayCount;
    document.getElementById('stat-hours').textContent = `${stats.totalHours}시간`;

    // 강사별 / 룸별: 많은 순 정렬
    const byInstructor = Object.entries(stats.byInstructor || {})
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    const byRoom = Object.entries(stats.byRoom || {})
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    // 요일별: 월~일 고정 순서
    const byWeekday = [1, 2, 3, 4, 5, 6, 0].map(d => ({
      label: WEEKDAYS[d],
      value: (stats.byWeekday || [])[d] || 0,
    }));

    // 시간대별: 운영시간 범위 오름차순
    const startHour = (adminConfig && adminConfig.startHour) || 9;
    const endHour = (adminConfig && adminConfig.endHour) || 22;
    const byHour = [];
    for (let h = startHour; h < endHour; h++) {
      byHour.push({ label: `${h}시`, value: (stats.byHour || {})[h] || 0 });
    }

    renderBarChart('chart-instructor', byInstructor);
    renderBarChart('chart-room', byRoom);
    renderBarChart('chart-weekday', byWeekday);
    renderBarChart('chart-hour', byHour);
  }

  // 단일 시리즈 가로 막대 차트 (값 라벨 직접 표기)
  function renderBarChart(containerId, items) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const nonZero = items.filter(it => it.value > 0);
    if (nonZero.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = '아직 데이터가 없습니다.';
      container.appendChild(empty);
      return;
    }

    const max = Math.max(...items.map(it => it.value), 1);
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.title = `${it.label}: ${it.value}건`;

      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = it.label;

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.round((it.value / max) * 100)}%`;
      fill.style.background = BAR_COLOR;
      track.appendChild(fill);

      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = it.value;

      row.append(label, track, value);
      container.appendChild(row);
    });
  }

  // === 예약 목록 ===
  async function loadAdminBookings() {
    const search = document.getElementById('admin-search')?.value || '';
    showLoading(true);
    try {
      const data = await API.adminGetAllBookings(token, currentPage, search);
      lastBookings = data.bookings || [];
      renderTable(data);
    } catch (err) {
      handleError(err, '데이터를 불러오는데 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  function renderTable(data) {
    const tbody = document.getElementById('admin-tbody');
    const totalEl = document.getElementById('admin-total');
    const paginationEl = document.getElementById('admin-pagination');

    totalEl.textContent = `총 ${data.total}건`;
    tbody.innerHTML = '';
    paginationEl.innerHTML = '';

    if (data.bookings.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 10;
      td.style.cssText = 'text-align:center; padding: 40px; color: #94a3b8;';
      td.textContent = '예약 데이터가 없습니다.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    data.bookings.forEach(b => {
      const bookingDate = new Date(b.date + 'T00:00:00');
      const isPast = bookingDate < today;

      const tr = document.createElement('tr');

      const cells = [
        b.date,
        b.instructor || '-',
        b.room,
        `${b.startTime} ~ ${b.endTime}`,
      ];
      cells.forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      const nameTd = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = b.name;
      nameTd.appendChild(strong);
      tr.appendChild(nameTd);

      [b.course || '-', b.topic || '-', `${b.people || 1}명`].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge ${isPast ? 'past' : 'active'}`;
      badge.textContent = isPast ? '지남' : '예정';
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      const actionTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-sm danger';
      delBtn.textContent = '삭제';
      delBtn.dataset.id = b.id;
      actionTd.appendChild(delBtn);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });

    if (data.totalPages > 1) {
      for (let p = 1; p <= data.totalPages; p++) {
        const btn = document.createElement('button');
        btn.textContent = p;
        btn.dataset.page = p;
        if (p === data.currentPage) btn.className = 'active';
        paginationEl.appendChild(btn);
      }
    }
  }

  // === 예약 삭제 ===
  let deleteTargetId = null;

  function openDeleteModal(id) {
    const b = lastBookings.find(x => x.id === id);
    deleteTargetId = id;

    const info = document.getElementById('admin-delete-info');
    info.innerHTML = '';
    if (b) {
      const strong = document.createElement('strong');
      strong.textContent = b.name;
      info.appendChild(strong);
      info.appendChild(document.createTextNode(` — ${b.room}`));
      info.appendChild(document.createElement('br'));
      info.appendChild(document.createTextNode(`${b.date} ${b.startTime}~${b.endTime}`));
    }
    document.getElementById('modal-admin-delete').classList.add('active');
  }

  window.closeAdminModal = function () {
    document.getElementById('modal-admin-delete').classList.remove('active');
    deleteTargetId = null;
  };

  async function executeAdminDelete() {
    if (!deleteTargetId) return;
    showLoading(true);
    try {
      await API.adminDeleteBooking(deleteTargetId, token);
      showToast('예약이 삭제되었습니다.', 'success');
      closeAdminModal();
      await loadAdminBookings();
    } catch (err) {
      handleError(err, '삭제에 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  // === CSV 내보내기 ===
  async function exportCsv() {
    showLoading(true);
    try {
      const data = await API.adminExport(token);
      const rows = [['날짜', '강사', '룸', '시작', '종료', '예약자', '과정명', '주제', '인원', '이메일', '생성일시']];
      (data.bookings || []).forEach(b => {
        rows.push([
          b.date, b.instructor, b.room, b.startTime, b.endTime,
          b.name, b.course, b.topic, b.people, b.email || '', b.createdAt,
        ]);
      });

      // U+FEFF BOM: 엑셀에서 한글 깨짐 방지
      const csv = '﻿' + rows
        .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      a.download = `mentoring_bookings_${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`${rows.length - 1}건을 내보냈습니다.`, 'success');
    } catch (err) {
      handleError(err, 'CSV 내보내기에 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  // === 검색 ===
  window.debounceSearch = function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      loadAdminBookings();
    }, 400);
  };

  // === 강사 관리 ===
  let editingInstructorName = null;
  let deletingInstructorName = null;
  let deleteNeedsForce = false;

  function renderInstructorList() {
    const container = document.getElementById('instructor-list');
    const countEl = document.getElementById('instructor-count');
    countEl.textContent = `${instructorList.length}명`;
    container.innerHTML = '';

    if (instructorList.length === 0) {
      const p = document.createElement('p');
      p.className = 'no-instructors';
      p.textContent = '등록된 강사가 없습니다. "강사 추가" 버튼을 눌러 추가하세요.';
      container.appendChild(p);
      return;
    }

    instructorList.forEach(name => {
      const chip = document.createElement('div');
      chip.className = 'instructor-chip';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chip-name';
      nameSpan.textContent = name;

      const actions = document.createElement('div');
      actions.className = 'chip-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'chip-btn edit';
      editBtn.title = '이름 변경';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.name = name;
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="pointer-events:none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

      const delBtn = document.createElement('button');
      delBtn.className = 'chip-btn delete';
      delBtn.title = '삭제';
      delBtn.dataset.action = 'delete';
      delBtn.dataset.name = name;
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="pointer-events:none;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      actions.append(editBtn, delBtn);
      chip.append(nameSpan, actions);
      container.appendChild(chip);
    });
  }

  async function reloadInstructors() {
    try {
      instructorList = await API.getInstructors();
      renderInstructorList();
    } catch (err) {
      console.error('강사 목록 로드 실패:', err);
    }
  }

  window.openInstructorModal = function (mode, name) {
    editingInstructorName = mode === 'edit' ? name : null;
    document.getElementById('instructor-modal-title').textContent = mode === 'edit' ? '강사명 변경' : '강사 추가';
    document.getElementById('input-instructor-name').value = mode === 'edit' ? name : '';
    document.getElementById('btn-instructor-submit').textContent = mode === 'edit' ? '변경' : '추가';
    document.getElementById('modal-instructor').classList.add('active');
    setTimeout(() => document.getElementById('input-instructor-name').focus(), 100);
  };

  window.closeInstructorModal = function () {
    document.getElementById('modal-instructor').classList.remove('active');
    editingInstructorName = null;
  };

  async function submitInstructor() {
    const name = document.getElementById('input-instructor-name').value.trim();
    if (!name) {
      showToast('강사명을 입력해주세요.', 'error');
      return;
    }

    showLoading(true);
    try {
      if (editingInstructorName) {
        await API.adminUpdateInstructor(editingInstructorName, name, token);
        showToast('강사명이 변경되었습니다.', 'success');
      } else {
        await API.adminAddInstructor(name, token);
        showToast('강사가 추가되었습니다.', 'success');
      }
      closeInstructorModal();
      await reloadInstructors();
    } catch (err) {
      handleError(err, '처리에 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  function confirmInstructorDelete(name) {
    deletingInstructorName = name;
    deleteNeedsForce = false;
    document.getElementById('instructor-delete-name').textContent = name;
    document.getElementById('instructor-delete-warning').textContent =
      '* 해당 강사의 기존 예약은 유지되지만, 강사 선택 목록에서 사라집니다.';
    document.getElementById('btn-instructor-confirm-delete').textContent = '삭제';
    document.getElementById('modal-instructor-delete').classList.add('active');
  }

  window.closeInstructorDeleteModal = function () {
    document.getElementById('modal-instructor-delete').classList.remove('active');
    deletingInstructorName = null;
    deleteNeedsForce = false;
  };

  async function executeInstructorDelete() {
    if (!deletingInstructorName) return;
    showLoading(true);
    try {
      const result = await API.adminDeleteInstructor(deletingInstructorName, token, deleteNeedsForce);

      if (result.needsConfirm) {
        // 예정 예약이 있는 경우 2차 확인
        deleteNeedsForce = true;
        document.getElementById('instructor-delete-warning').textContent =
          `⚠ 이 강사의 예정된 예약이 ${result.futureCount}건 있습니다. 예약은 삭제되지 않고 그대로 유지됩니다. 그래도 강사를 삭제하시겠습니까?`;
        document.getElementById('btn-instructor-confirm-delete').textContent = '그래도 삭제';
        return;
      }

      showToast('강사가 삭제되었습니다.', 'success');
      closeInstructorDeleteModal();
      await reloadInstructors();
    } catch (err) {
      handleError(err, '삭제에 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  // === 룸 차단 관리 ===
  function populateBlockForm() {
    const roomSelect = document.getElementById('block-room');
    const startSelect = document.getElementById('block-start');
    const endSelect = document.getElementById('block-end');
    const dateInput = document.getElementById('block-date');

    roomSelect.innerHTML = '';
    (adminConfig.rooms || []).forEach(room => {
      const opt = document.createElement('option');
      opt.value = room;
      opt.textContent = room;
      roomSelect.appendChild(opt);
    });

    const slots = [];
    const totalMinutes = (adminConfig.endHour - adminConfig.startHour) * 60;
    for (let m = 0; m <= totalMinutes; m += adminConfig.slotMinutes) {
      const hour = adminConfig.startHour + Math.floor(m / 60);
      const min = m % 60;
      slots.push(`${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }

    startSelect.innerHTML = '';
    endSelect.innerHTML = '';
    slots.slice(0, -1).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      startSelect.appendChild(opt);
    });
    slots.slice(1).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      endSelect.appendChild(opt);
    });
    endSelect.value = slots[slots.length - 1];

    // 기본 날짜 = 오늘
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async function submitBlock() {
    const date = document.getElementById('block-date').value;
    const room = document.getElementById('block-room').value;
    const startTime = document.getElementById('block-start').value;
    const endTime = document.getElementById('block-end').value;
    const reason = document.getElementById('block-reason').value.trim();

    if (!date || !room) {
      showToast('날짜와 룸을 선택해주세요.', 'error');
      return;
    }
    if (startTime >= endTime) {
      showToast('종료 시간은 시작 시간보다 늦어야 합니다.', 'error');
      return;
    }

    showLoading(true);
    try {
      const result = await API.adminAddBlock({ date, room, startTime, endTime, reason }, token);
      blocks = result.blocks || [];
      renderBlocks();
      document.getElementById('block-reason').value = '';
      showToast('룸 차단이 추가되었습니다.', 'success');
    } catch (err) {
      handleError(err, '차단 추가에 실패했습니다.');
    } finally {
      showLoading(false);
    }
  }

  function renderBlocks() {
    const container = document.getElementById('block-list');
    container.innerHTML = '';

    if (!blocks || blocks.length === 0) {
      const p = document.createElement('p');
      p.className = 'no-instructors';
      p.style.padding = '12px 20px';
      p.textContent = '등록된 차단이 없습니다.';
      container.appendChild(p);
      return;
    }

    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    blocks.forEach(bl => {
      const item = document.createElement('div');
      item.className = 'block-item' + (bl.date < todayStr ? ' past' : '');

      const info = document.createElement('div');
      info.className = 'block-item-info';

      const title = document.createElement('span');
      title.className = 'block-item-title';
      title.textContent = `${bl.date} ${bl.startTime}~${bl.endTime} · ${bl.room}`;

      const reason = document.createElement('span');
      reason.className = 'block-item-reason';
      reason.textContent = bl.reason || '사유 없음';

      info.append(title, reason);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-sm danger';
      delBtn.textContent = '해제';
      delBtn.dataset.blockId = bl.id;

      item.append(info, delBtn);
      container.appendChild(item);
    });
  }

  // === Helpers ===
  function showToast(message, type) {
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

  function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
  }

})();
