/**
 * Google Apps Script API 통신 모듈
 */
const API = {
  /**
   * 예약 목록 조회 (날짜별)
   */
  async getBookings(date, instructor) {
    if (!CONFIG.SCRIPT_URL) {
      return this._getDemoData(date, instructor);
    }
    const url = `${CONFIG.SCRIPT_URL}?action=getBookings&date=${date}&instructor=${encodeURIComponent(instructor || '')}&_t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return { bookings: data.bookings || [], roomBlocks: data.roomBlocks || [] };
  },

  /**
   * 예약 생성
   */
  async createBooking(booking) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoCRUD('create', booking);
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'create', ...booking }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 예약 수정
   */
  async updateBooking(id, booking, password) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoCRUD('update', { id, ...booking, password });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'update', id, ...booking, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 예약 삭제
   */
  async deleteBooking(id, password) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoCRUD('delete', { id, password });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'delete', id, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 관리자 로그인
   */
  async adminLogin(password) {
    if (!CONFIG.SCRIPT_URL) {
      return { success: password === 'admin1234' };
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'adminLogin', password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 관리자: 전체 예약 조회
   */
  async adminGetAllBookings(adminPassword, page, search) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoAdminData(page, search);
    }
    const url = `${CONFIG.SCRIPT_URL}?action=adminGetAll&password=${encodeURIComponent(adminPassword)}&page=${page}&search=${encodeURIComponent(search || '')}&_t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 관리자: 예약 강제 삭제
   */
  async adminDeleteBooking(id, adminPassword) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoCRUD('adminDelete', { id, adminPassword });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'adminDelete', id, adminPassword }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 강사 목록 조회 (누구나 호출 가능)
   */
  async getInstructors() {
    if (!CONFIG.SCRIPT_URL) {
      return this._getDemoInstructors();
    }
    const url = `${CONFIG.SCRIPT_URL}?action=getInstructors&_t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.instructors || [];
  },

  /**
   * 관리자: 강사 추가
   */
  async adminAddInstructor(name, adminPassword) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoInstructorCRUD('add', { name });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'addInstructor', name, adminPassword }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 관리자: 강사명 수정
   */
  async adminUpdateInstructor(oldName, newName, adminPassword) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoInstructorCRUD('update', { oldName, newName });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'updateInstructor', oldName, newName, adminPassword }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  /**
   * 관리자: 강사 삭제
   */
  async adminDeleteInstructor(name, adminPassword) {
    if (!CONFIG.SCRIPT_URL) {
      return this._demoInstructorCRUD('delete', { name });
    }
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'deleteInstructor', name, adminPassword }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  // ============================
  // 데모 모드 (GAS 미연결 시)
  // ============================
  _demoInstructors: JSON.parse(localStorage.getItem('demo_instructors') || 'null') || [...(CONFIG.instructors || [])],

  _saveDemoInstructors() {
    localStorage.setItem('demo_instructors', JSON.stringify(this._demoInstructors));
  },

  _getDemoInstructors() {
    return [...this._demoInstructors];
  },

  _demoInstructorCRUD(action, data) {
    if (action === 'add') {
      if (this._demoInstructors.includes(data.name)) throw new Error('이미 존재하는 강사명입니다.');
      this._demoInstructors.push(data.name);
      this._saveDemoInstructors();
      return { success: true };
    }
    if (action === 'update') {
      const idx = this._demoInstructors.indexOf(data.oldName);
      if (idx === -1) throw new Error('강사를 찾을 수 없습니다.');
      if (data.oldName !== data.newName && this._demoInstructors.includes(data.newName)) throw new Error('이미 존재하는 강사명입니다.');
      this._demoInstructors[idx] = data.newName;
      this._saveDemoInstructors();
      // 기존 예약의 강사명도 변경
      this._demoStore.forEach(b => {
        if (b.instructor === data.oldName) b.instructor = data.newName;
      });
      this._saveDemoStore();
      return { success: true };
    }
    if (action === 'delete') {
      const idx = this._demoInstructors.indexOf(data.name);
      if (idx === -1) throw new Error('강사를 찾을 수 없습니다.');
      this._demoInstructors.splice(idx, 1);
      this._saveDemoInstructors();
      return { success: true };
    }
    return { success: false };
  },

  _demoStore: JSON.parse(localStorage.getItem('demo_bookings') || '[]'),

  _saveDemoStore() {
    localStorage.setItem('demo_bookings', JSON.stringify(this._demoStore));
  },

  _getDemoData(date, instructor) {
    const bookings = this._demoStore.filter(b => b.date === date && (!instructor || b.instructor === instructor));
    const roomBlocks = this._demoStore
      .filter(b => b.date === date && instructor && b.instructor !== instructor)
      .map(b => ({ room: b.room, startTime: b.startTime, endTime: b.endTime, instructor: b.instructor }));
    return { bookings, roomBlocks };
  },

  _demoHasRoomConflict(date, room, startTime, endTime, excludeId) {
    return this._demoStore.some(b => {
      if (excludeId && b.id === excludeId) return false;
      return b.date === date && b.room === room && startTime < b.endTime && endTime > b.startTime;
    });
  },

  _demoCRUD(action, data) {
    if (action === 'create') {
      if (this._demoHasRoomConflict(data.date, data.room, data.startTime, data.endTime)) {
        throw new Error('해당 시간에 이미 다른 예약이 있는 룸입니다.');
      }
      const booking = {
        id: 'demo_' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      };
      this._demoStore.push(booking);
      this._saveDemoStore();
      return { success: true, booking };
    }
    if (action === 'update') {
      const idx = this._demoStore.findIndex(b => b.id === data.id);
      if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
      if (this._demoStore[idx].password !== data.password) throw new Error('비밀번호가 일치하지 않습니다.');
      Object.assign(this._demoStore[idx], data);
      this._saveDemoStore();
      return { success: true };
    }
    if (action === 'delete') {
      const idx = this._demoStore.findIndex(b => b.id === data.id);
      if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
      if (this._demoStore[idx].password !== data.password) throw new Error('비밀번호가 일치하지 않습니다.');
      this._demoStore.splice(idx, 1);
      this._saveDemoStore();
      return { success: true };
    }
    if (action === 'adminDelete') {
      const idx = this._demoStore.findIndex(b => b.id === data.id);
      if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
      this._demoStore.splice(idx, 1);
      this._saveDemoStore();
      return { success: true };
    }
    return { success: false };
  },

  _demoAdminData(page, search) {
    let bookings = [...this._demoStore];
    if (search) {
      const q = search.toLowerCase();
      bookings = bookings.filter(b =>
        b.name?.toLowerCase().includes(q) ||
        b.topic?.toLowerCase().includes(q) ||
        b.room?.toLowerCase().includes(q) ||
        b.instructor?.toLowerCase().includes(q)
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
  },
};
