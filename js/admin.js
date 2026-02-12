/**
 * 관리자 페이지 로직
 */
(function () {
  let adminPassword = '';
  let currentPage = 1;
  let searchTimeout = null;

  document.addEventListener('DOMContentLoaded', () => {
    // 세션 체크 (sessionStorage에 임시 저장)
    const saved = sessionStorage.getItem('admin_auth');
    if (saved) {
      adminPassword = saved;
      showDashboard();
    }
  });

  // === Login ===
  window.adminLoginSubmit = async function () {
    const pw = document.getElementById('admin-password').value;
    if (!pw) {
      showToast('비밀번호를 입력해주세요.', 'error');
      return;
    }

    showLoading(true);
    try {
      const result = await API.adminLogin(pw);
      if (result.success) {
        adminPassword = pw;
        sessionStorage.setItem('admin_auth', pw);
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
    adminPassword = '';
    sessionStorage.removeItem('admin_auth');
    document.getElementById('login-section').style.display = '';
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'none';
    document.getElementById('admin-password').value = '';
    showToast('로그아웃되었습니다.', 'info');
  };

  function showDashboard() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = '';
    document.getElementById('btn-logout').style.display = '';
    loadInstructors();
    loadAdminBookings();
  }

  // === Load Bookings ===
  async function loadAdminBookings() {
    const search = document.getElementById('admin-search')?.value || '';
    showLoading(true);
    try {
      const data = await API.adminGetAllBookings(adminPassword, currentPage, search);
      renderTable(data);
    } catch (err) {
      showToast(err.message || '데이터를 불러오는데 실패했습니다.', 'error');
      if (err.message?.includes('인증')) {
        adminLogout();
      }
    } finally {
      showLoading(false);
    }
  }

  // === Render Table ===
  function renderTable(data) {
    const tbody = document.getElementById('admin-tbody');
    const totalEl = document.getElementById('admin-total');
    const paginationEl = document.getElementById('admin-pagination');

    totalEl.textContent = `총 ${data.total}건`;

    if (data.bookings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 40px; color: #94a3b8;">예약 데이터가 없습니다.</td></tr>';
      paginationEl.innerHTML = '';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tbody.innerHTML = data.bookings.map(b => {
      const bookingDate = new Date(b.date + 'T00:00:00');
      const isPast = bookingDate < today;
      const statusClass = isPast ? 'past' : 'active';
      const statusText = isPast ? '지남' : '예정';

      return `
        <tr>
          <td>${escapeHtml(b.date)}</td>
          <td>${escapeHtml(b.instructor || '-')}</td>
          <td>${escapeHtml(b.room)}</td>
          <td>${escapeHtml(b.startTime)} ~ ${escapeHtml(b.endTime)}</td>
          <td><strong>${escapeHtml(b.name)}</strong></td>
          <td>${escapeHtml(b.course || '-')}</td>
          <td>${escapeHtml(b.topic || '-')}</td>
          <td>${b.people || 1}명</td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>
            <button class="btn-sm danger" onclick="confirmAdminDelete('${b.id}', '${escapeHtml(b.name)}', '${escapeHtml(b.room)}', '${b.date}', '${b.startTime}~${b.endTime}')">
              삭제
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Pagination
    if (data.totalPages > 1) {
      let phtml = '';
      for (let p = 1; p <= data.totalPages; p++) {
        phtml += `<button class="${p === data.currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
      }
      paginationEl.innerHTML = phtml;
    } else {
      paginationEl.innerHTML = '';
    }
  }

  // === Delete ===
  let deleteTargetId = null;

  window.confirmAdminDelete = function (id, name, room, date, time) {
    deleteTargetId = id;
    document.getElementById('admin-delete-info').innerHTML = `
      <strong>${name}</strong> — ${room}<br>
      ${date} ${time}
    `;
    document.getElementById('modal-admin-delete').classList.add('active');
  };

  window.closeAdminModal = function () {
    document.getElementById('modal-admin-delete').classList.remove('active');
    deleteTargetId = null;
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-admin-confirm-delete')?.addEventListener('click', async () => {
      if (!deleteTargetId) return;
      showLoading(true);
      try {
        await API.adminDeleteBooking(deleteTargetId, adminPassword);
        showToast('예약이 삭제되었습니다.', 'success');
        closeAdminModal();
        await loadAdminBookings();
      } catch (err) {
        showToast(err.message || '삭제에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    });

    // Close modal on overlay click
    document.getElementById('modal-admin-delete')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-admin-delete') closeAdminModal();
    });
  });

  // === Pagination ===
  window.goToPage = function (page) {
    currentPage = page;
    loadAdminBookings();
  };

  // === Search ===
  window.debounceSearch = function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      loadAdminBookings();
    }, 400);
  };

  // === Instructor Management ===
  let instructorList = [];
  let editingInstructorName = null; // null = add mode, string = edit mode
  let deletingInstructorName = null;

  async function loadInstructors() {
    try {
      instructorList = await API.getInstructors();
      renderInstructorList();
    } catch (err) {
      console.error('강사 목록 로드 실패:', err);
    }
  }

  function renderInstructorList() {
    const container = document.getElementById('instructor-list');
    const countEl = document.getElementById('instructor-count');
    countEl.textContent = `${instructorList.length}명`;

    if (instructorList.length === 0) {
      container.innerHTML = '<p class="no-instructors">등록된 강사가 없습니다. "강사 추가" 버튼을 눌러 추가하세요.</p>';
      return;
    }

    container.innerHTML = instructorList.map(name => `
      <div class="instructor-chip">
        <span class="chip-name">${escapeHtml(name)}</span>
        <div class="chip-actions">
          <button class="chip-btn edit" onclick="openInstructorModal('edit', '${escapeHtml(name)}')" title="이름 변경">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="chip-btn delete" onclick="confirmInstructorDelete('${escapeHtml(name)}')" title="삭제">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
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

  window.confirmInstructorDelete = function (name) {
    deletingInstructorName = name;
    document.getElementById('instructor-delete-name').textContent = name;
    document.getElementById('modal-instructor-delete').classList.add('active');
  };

  window.closeInstructorDeleteModal = function () {
    document.getElementById('modal-instructor-delete').classList.remove('active');
    deletingInstructorName = null;
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Instructor submit
    document.getElementById('btn-instructor-submit')?.addEventListener('click', async () => {
      const name = document.getElementById('input-instructor-name').value.trim();
      if (!name) {
        showToast('강사명을 입력해주세요.', 'error');
        return;
      }

      showLoading(true);
      try {
        if (editingInstructorName) {
          await API.adminUpdateInstructor(editingInstructorName, name, adminPassword);
          showToast('강사명이 변경되었습니다.', 'success');
        } else {
          await API.adminAddInstructor(name, adminPassword);
          showToast('강사가 추가되었습니다.', 'success');
        }
        closeInstructorModal();
        await loadInstructors();
      } catch (err) {
        showToast(err.message || '처리에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    });

    // Instructor delete confirm
    document.getElementById('btn-instructor-confirm-delete')?.addEventListener('click', async () => {
      if (!deletingInstructorName) return;
      showLoading(true);
      try {
        await API.adminDeleteInstructor(deletingInstructorName, adminPassword);
        showToast('강사가 삭제되었습니다.', 'success');
        closeInstructorDeleteModal();
        await loadInstructors();
      } catch (err) {
        showToast(err.message || '삭제에 실패했습니다.', 'error');
      } finally {
        showLoading(false);
      }
    });

    // Enter key for instructor name
    document.getElementById('input-instructor-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-instructor-submit').click();
    });

    // Close modals on overlay click
    document.getElementById('modal-instructor')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-instructor') closeInstructorModal();
    });
    document.getElementById('modal-instructor-delete')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-instructor-delete') closeInstructorDeleteModal();
    });
  });

  // === Helpers ===
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, type) {
    if (window.showToast && window.showToast !== showToast) {
      window.showToast(message, type);
      return;
    }
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
